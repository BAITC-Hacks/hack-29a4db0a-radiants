import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { NextResponse } from "next/server";
import { z } from "zod";
import type { AuthSession, DemoLoginSelection, SessionUser } from "@/contracts/auth";
import { getDatabase } from "@/server/db/database";
import { AppError } from "@/server/errors";
import { isDemoEmployeeLoginEnabled, isDemoUserId, normalizeEmployeeName, resolveDemoEmployeeLogin, revokeDemoSessions } from "./demo-login";

export const SESSION_COOKIE = "cq_session";
export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const usernameSchema = z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9_.-]+$/).transform((name) => name.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const loginNameSchema = z.string().trim().min(1).max(200).refine(
  (name) => isDemoEmployeeLoginEnabled() || usernameSchema.safeParse(name).success,
  "Use your individual account username",
);
export const loginSchema = z.object({ username: loginNameSchema, password: z.string().min(1).max(128), employeeId: z.string().min(1).max(100).optional() }).strict();
export const accountSchema = z.object({ username: usernameSchema, password: passwordSchema, employeeId: z.string().min(1).max(100) }).strict();

interface UserRow { user_id: string; username: string; role: SessionUser["role"]; employee_id: string | null; password_hash: string; active: number; employee_name?: string | null }
function publicUser(row: UserRow): SessionUser {
  return { id: row.user_id, username: isDemoUserId(row.user_id) && row.employee_name ? row.employee_name : row.username, role: row.role, employeeId: row.employee_id };
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString("hex")}`;
}
function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, salt, expected] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !expected || expected.length !== 128) return false;
  return secureEqual(scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString("hex"), expected);
}
// Unknown usernames still perform the same password derivation.
const DUMMY_PASSWORD_HASH = `scrypt:00000000000000000000000000000000:${"0".repeat(128)}`;

export function audit(userId: string | null, action: string, targetId?: string, db = getDatabase()): void {
  db.prepare("INSERT INTO auth_audit(audit_id,user_id,action,target_id,created_at) VALUES (?,?,?,?,?)")
    .run(randomUUID(), userId, action, targetId ?? null, Date.now());
}

export function createUser(input: { username: string; password: string; role: SessionUser["role"]; employeeId?: string | null }, db = getDatabase()): SessionUser {
  const username = usernameSchema.parse(input.username);
  const password = passwordSchema.parse(input.password);
  const role = z.enum(["employee", "hr"]).parse(input.role);
  const employeeId = role === "employee" ? input.employeeId : null;
  if (role === "employee" && (!employeeId || !db.prepare("SELECT 1 FROM employees WHERE employee_id=?").get(employeeId))) {
    throw new AppError(422, "EMPLOYEE_NOT_FOUND", "The linked employee must exist before an account is created");
  }
  if (db.prepare("SELECT 1 FROM auth_users WHERE username=? COLLATE NOCASE").get(username)) {
    throw new AppError(409, "USERNAME_EXISTS", "This username is already in use");
  }
  const user = { id: randomUUID(), username, role, employeeId: employeeId ?? null };
  db.prepare("INSERT INTO auth_users(user_id,username,password_hash,role,employee_id,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.username, hashPassword(password), role, user.employeeId, Date.now());
  return user;
}

/** Initial local demo credentials are generated once and never sent through an HTTP endpoint. */
export function ensureAuthBootstrap(db = getDatabase()): void {
  if (!isDemoEmployeeLoginEnabled()) revokeDemoSessions(db);
  if ((db.prepare("SELECT COUNT(*) AS count FROM auth_users").get() as { count: number }).count) return;
  const directory = path.dirname(db.name);
  const credentialsPath = path.join(/* turbopackIgnore: true */ directory, "initial-access.json");
  db.transaction(() => {
    if ((db.prepare("SELECT COUNT(*) AS count FROM auth_users").get() as { count: number }).count) return;
    const ids = db.prepare("SELECT employee_id FROM employees ORDER BY CASE employee_id WHEN 'E0178' THEN 0 WHEN 'E0058' THEN 1 ELSE 2 END, employee_id LIMIT 2").all() as { employee_id: string }[];
    const accounts = [
      { username: "hr-admin", role: "hr" as const, employeeId: null, password: randomBytes(18).toString("base64url") },
      ...ids.map((row, index) => ({ username: index ? "employee2" : "employee", role: "employee" as const, employeeId: row.employee_id, password: randomBytes(18).toString("base64url") })),
    ];
    for (const account of accounts) createUser(account, db);
    // mode 0600 applies on Linux; the enclosing local/volume directory is operator-owned.
    fs.writeFileSync(/* turbopackIgnore: true */ credentialsPath, JSON.stringify({ generatedAt: new Date().toISOString(), accounts }, null, 2), { mode: 0o600 });
    audit(null, "accounts.bootstrapped", undefined, db);
  }).immediate();
}

function authDatabase(): Database.Database {
  const db = getDatabase();
  ensureAuthBootstrap(db);
  return db;
}
function sessionToken(request: Request): string | undefined {
  const parts = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  const values = parts.filter((part) => part.startsWith(SESSION_COOKIE + "="));
  if (values.length !== 1) return;
  const token = values[0]!.slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
const csrfFor = (token: string) => digest("career-quest-csrf:" + token);

export function createSession(user: SessionUser, db = getDatabase()): { session: AuthSession; token: string } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expires = now + SESSION_DURATION_MS;
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run(digest(token), user.id, now, expires);
  return { token, session: { user, expiresAt: new Date(expires).toISOString(), csrfToken: csrfFor(token) } };
}

export function authenticate(request: Request, db = authDatabase()): AuthSession {
  const token = sessionToken(request);
  if (!token) throw new AppError(401, "AUTH_REQUIRED", "Sign in to continue");
  const row = db.prepare(`SELECT u.*, s.expires_at, e.full_name AS employee_name FROM auth_sessions s JOIN auth_users u ON u.user_id=s.user_id
    LEFT JOIN employees e ON e.employee_id=u.employee_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digest(token), Date.now()) as (UserRow & { expires_at: number }) | undefined;
  if (!row) throw new AppError(401, "AUTH_REQUIRED", "Your session has expired or is no longer valid");
  if (isDemoUserId(row.user_id) && (!isDemoEmployeeLoginEnabled() || row.role !== "employee" || !row.employee_name)) {
    db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(row.user_id);
    throw new AppError(401, "AUTH_REQUIRED", "Demo access has ended. Sign in with your individual account.");
  }
  return { user: publicUser(row), expiresAt: new Date(row.expires_at).toISOString(), csrfToken: csrfFor(token) };
}

export function requireHr(session: AuthSession): void {
  if (session.user.role !== "hr") throw new AppError(403, "FORBIDDEN", "This action is available to HR only");
}
export function requireEmployeeAccess(session: AuthSession, employeeId: string): void {
  if (session.user.role !== "hr" && session.user.employeeId !== employeeId) {
    throw new AppError(403, "FORBIDDEN", "You can access only your own employee profile");
  }
}
export function requireSelf(session: AuthSession, employeeId: string): void {
  if (session.user.role !== "employee" || session.user.employeeId !== employeeId) {
    throw new AppError(403, "FORBIDDEN", "Only the employee can mark their own activity complete");
  }
}

export function assertOrigin(request: Request): void {
  const expected = new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
  const origin = request.headers.get("origin");
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError(403, "ORIGIN_FORBIDDEN", "The request must originate from this application");
  }
}
export function assertMutation(request: Request, session: AuthSession): void {
  assertOrigin(request);
  if (!secureEqual(request.headers.get("x-csrf-token") ?? "", session.csrfToken)) {
    throw new AppError(403, "CSRF_INVALID", "Refresh your session before submitting this request");
  }
}

export function login(username: string, password: string, db = authDatabase(), employeeId?: string): { session: AuthSession; token: string } | DemoLoginSelection {
  const normalized = normalizeEmployeeName(username);
  const now = Date.now();
  db.prepare("DELETE FROM auth_login_attempts WHERE window_start <= ?").run(now - LOGIN_WINDOW_MS);
  const keys = ["user:" + digest(normalized), "global"];
  for (const [index, key] of keys.entries()) {
    const attempt = db.prepare("SELECT failures FROM auth_login_attempts WHERE attempt_key=?").get(key) as { failures: number } | undefined;
    if (attempt && attempt.failures >= (index ? 100 : 5)) throw new AppError(429, "LOGIN_RATE_LIMITED", "Too many login attempts. Try again in 15 minutes");
  }
  let row = db.prepare("SELECT * FROM auth_users WHERE username=? COLLATE NOCASE").get(normalized) as UserRow | undefined;
  let valid = verifyPassword(password, row && !isDemoUserId(row.user_id) ? row.password_hash : DUMMY_PASSWORD_HASH);
  // The shared password never authenticates an HR account or replaces its password.
  if (isDemoEmployeeLoginEnabled() && secureEqual(password, "admin") && row?.role !== "hr") {
    const result = resolveDemoEmployeeLogin(username, db, employeeId);
    if (result && "kind" in result) return result;
    row = result;
    valid = Boolean(row);
  } else if (employeeId !== undefined) {
    // Selection is an internal part of the gated demo flow, not another login credential.
    valid = false;
  }
  if (!row || !valid || !row.active) {
    db.transaction(() => {
      for (const key of keys) db.prepare(`INSERT INTO auth_login_attempts(attempt_key,failures,window_start) VALUES (?,1,?)
        ON CONFLICT(attempt_key) DO UPDATE SET failures=failures+1`).run(key, now);
    })();
    throw new AppError(401, "INVALID_CREDENTIALS", "Username or password is incorrect");
  }
  db.prepare("DELETE FROM auth_login_attempts WHERE attempt_key=?").run(keys[0]);
  audit(row.user_id, isDemoUserId(row.user_id) ? "session.demo_login" : "session.login", undefined, db);
  return createSession(publicUser(row), db);
}

export function logout(request: Request, db = getDatabase()): void {
  const token = sessionToken(request);
  if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(token));
}
export function setSessionCookie(response: NextResponse, token: string, expiresAt: string): void {
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: (process.env.APP_ORIGIN ?? "").startsWith("https://"), path: "/", expires: new Date(expiresAt) });
}
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: (process.env.APP_ORIGIN ?? "").startsWith("https://"), path: "/", maxAge: 0 });
}
export function listAccounts(db = getDatabase()): (SessionUser & { active: boolean })[] {
  return (db.prepare("SELECT user_id,username,role,employee_id,active FROM auth_users ORDER BY username").all() as UserRow[])
    .map((row) => ({ ...publicUser(row), active: Boolean(row.active) }));
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as listRoute } from "@/app/api/employees/route";
import { GET as employeeRoute } from "@/app/api/employees/[employeeId]/route";
import { GET as recommendationsRoute } from "@/app/api/employees/[employeeId]/recommendations/route";
import { POST as completionRoute } from "@/app/api/employees/[employeeId]/activities/[eventId]/complete/route";
import { GET as hrRoute } from "@/app/api/hr/summary/route";
import { POST as importRoute } from "@/app/api/import/route";
import { GET as catalogRoute } from "@/app/api/catalog/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { GET as accountsRoute, POST as createAccountRoute } from "@/app/api/hr/accounts/route";
import { createSession, createUser, ensureAuthBootstrap } from "@/server/auth";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { authHeaders, TEST_PASSWORD, testIdentity, type TestIdentity } from "./helpers/auth";

let directory: string;
let employee: TestIdentity;
let hr: TestIdentity;

beforeEach(async () => {
  closeDatabase();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-auth-test-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "auth.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  employee = await testIdentity("employee", "E0178");
  hr = await testIdentity("hr");
});

afterEach(() => {
  vi.useRealTimers();
  closeDatabase();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});

function request(url: string, identity?: TestIdentity, init: RequestInit = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    ...init,
    signal: init.signal ?? undefined,
    headers: identity ? authHeaders(identity, init.headers) : init.headers,
  });
}

const context = (employeeId = "E0178") => ({ params: Promise.resolve({ employeeId }) });
const completionContext = (employeeId = "E0178", eventId = "EV_005") => ({ params: Promise.resolve({ employeeId, eventId }) });
const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("server-enforced privacy and access roles", () => {
  it("bootstraps three usable private accounts once without altering the business dataset", async () => {
    closeDatabase();
    vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "fresh-bootstrap.sqlite"));
    const db = getDatabase();
    const counts = databaseCounts(db);
    const write = vi.spyOn(fs, "writeFileSync");
    try {
      expect(() => ensureAuthBootstrap(db)).not.toThrow();
      const health = healthRoute();
      expect(health.status).toBe(200);
      expect((await health.json()).data).toMatchObject({ schemaVersion: 2, counts });
      const credentialsPath = path.join(directory, "initial-access.json");
      expect(write).toHaveBeenCalledWith(credentialsPath, expect.any(String), { mode: 0o600 });
      if (process.platform !== "win32") expect(fs.statSync(credentialsPath).mode & 0o777).toBe(0o600);
      const originalFile = fs.readFileSync(credentialsPath, "utf8");
      const initial = JSON.parse(originalFile) as {
        accounts: { username: string; password: string; role: string; employeeId: string | null }[];
      };
      expect(initial.accounts).toHaveLength(3);
      expect(initial.accounts.map(({ username }) => username)).toEqual(["hr-admin", "employee", "employee2"]);
      expect(initial.accounts.map(({ role }) => role)).toEqual(["hr", "employee", "employee"]);
      expect(initial.accounts.map(({ employeeId }) => employeeId)).toEqual([null, "E0178", "E0058"]);
      for (const account of initial.accounts) {
        expect(account.password.length).toBeGreaterThanOrEqual(12);
        const response = await loginRoute(request("/api/auth/login", undefined, {
          ...jsonPost({ username: account.username, password: account.password }),
          headers: { "Origin": "http://localhost", "Content-Type": "application/json" },
        }));
        expect(response.status).toBe(200);
        expect((await response.json()).data.user).toMatchObject({ username: account.username, role: account.role, employeeId: account.employeeId });
      }
      expect(databaseCounts(db)).toEqual(counts);
      ensureAuthBootstrap(db);
      expect((db.prepare("SELECT COUNT(*) AS count FROM auth_users").get() as { count: number }).count).toBe(3);
      expect(write).toHaveBeenCalledTimes(1);
      closeDatabase();
      ensureAuthBootstrap(getDatabase());
      expect(fs.readFileSync(credentialsPath, "utf8")).toBe(originalFile);
      expect(databaseCounts()).toEqual(counts);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });

  it("keeps readiness health public while protecting every private route", async () => {
    expect(healthRoute().status).toBe(200);
    const responses = await Promise.all([
      sessionRoute(request("/api/auth/session")),
      listRoute(request("/api/employees")),
      employeeRoute(request("/api/employees/E0178"), context()),
      recommendationsRoute(request("/api/employees/E0178/recommendations"), context()),
      completionRoute(request("/api/employees/E0178/activities/EV_005/complete", undefined, jsonPost({})), completionContext()),
      catalogRoute(request("/api/catalog")),
      hrRoute(request("/api/hr/summary")),
      importRoute(request("/api/import", undefined, { method: "POST" })),
      accountsRoute(request("/api/hr/accounts")),
      createAccountRoute(request("/api/hr/accounts", undefined, jsonPost({}))),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("lists only the signed-in employee and denies access to another person's history and AI", async () => {
    const ownList = await listRoute(request("/api/employees", employee));
    const items = (await ownList.json()).data.items;
    expect(items).toHaveLength(1);
    expect(items[0].employeeId).toBe("E0178");
    expect(items[0]).not.toHaveProperty("activities");
    const ownProfile = await employeeRoute(request("/api/employees/E0178", employee), context());
    expect(ownProfile.status).toBe(200);
    expect(ownProfile.headers.get("cache-control")).toContain("no-store");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    for (const id of ["E0001", "MISSING"]) {
      const detail = await employeeRoute(request(`/api/employees/${id}`, employee), context(id));
      const recs = await recommendationsRoute(request(`/api/employees/${id}/recommendations`, employee), context(id));
      expect(detail.status).toBe(403);
      expect(recs.status).toBe(403);
    }
    expect(provider).not.toHaveBeenCalled();
    const spoofed = authHeaders(employee, { "X-User-Role": "hr", "X-Employee-Id": "E0001" });
    expect((await employeeRoute(new Request("http://localhost/api/employees/E0001", { headers: spoofed }), context("E0001"))).status).toBe(403);
  });

  it("restricts analytics, import, and account administration to HR", async () => {
    expect((await hrRoute(request("/api/hr/summary", employee))).status).toBe(403);
    expect((await importRoute(request("/api/import", employee, { method: "POST" }))).status).toBe(403);
    expect((await accountsRoute(request("/api/hr/accounts", employee))).status).toBe(403);
    expect((await createAccountRoute(request("/api/hr/accounts", employee, jsonPost({})))).status).toBe(403);
    const list = await listRoute(request("/api/employees", hr));
    expect((await list.json()).data.items).toHaveLength(200);
    expect((await employeeRoute(request("/api/employees/E0001", hr), context("E0001"))).status).toBe(200);
    expect((await hrRoute(request("/api/hr/summary", hr))).status).toBe(200);
  });

  it("lets employees voluntarily complete only their own activities and forbids HR completing on their behalf", async () => {
    const before = databaseCounts().activityHistory;
    for (const [identity, id] of [[employee, "E0001"], [hr, "E0178"]] as const) {
      const response = await completionRoute(request(`/api/employees/${id}/activities/EV_005/complete`, identity, jsonPost({})), completionContext(id));
      expect(response.status).toBe(403);
    }
    expect(databaseCounts().activityHistory).toBe(before);
    const response = await completionRoute(request("/api/employees/E0178/activities/EV_005/complete", employee, jsonPost({})), completionContext());
    expect(response.status).toBe(201);
    expect((await response.json()).data.view.readiness).toBe(74.1);
    expect(databaseCounts().activityHistory).toBe(before + 1);
  });

  it("rejects absent or incorrect CSRF and cross-origin writes before changing data", async () => {
    const before = databaseCounts().activityHistory;
    for (const change of [
      (headers: Headers) => headers.delete("X-CSRF-Token"),
      (headers: Headers) => headers.set("X-CSRF-Token", "wrong"),
      (headers: Headers) => headers.set("X-CSRF-Token", hr.session.csrfToken),
      (headers: Headers) => headers.set("Origin", "https://attacker.example"),
      (headers: Headers) => headers.delete("Origin"),
    ]) {
      const headers = authHeaders(employee);
      change(headers);
      const response = await completionRoute(new Request("http://localhost/api/employees/E0178/activities/EV_005/complete", { ...jsonPost({}), headers }), completionContext());
      expect(response.status).toBe(403);
      expect(["CSRF_INVALID", "ORIGIN_FORBIDDEN"]).toContain((await response.json()).error.code);
    }
    expect(databaseCounts().activityHistory).toBe(before);
  });

  it("uses a secure session cookie and revokes it on logout without disclosing passwords or token hashes", async () => {
    const username = "session-lifecycle";
    createUser({ username, password: TEST_PASSWORD, role: "employee", employeeId: "E0178" });
    const response = await loginRoute(request("/api/auth/login", undefined, {
      ...jsonPost({ username, password: TEST_PASSWORD }), headers: { "Origin": "http://localhost", "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("cq_session=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//i);
    const session = (await response.json()).data;
    expect(session.user).toMatchObject({ username, role: "employee", employeeId: "E0178" });
    expect(session.csrfToken).toBeTypeOf("string");
    expect(JSON.stringify(session)).not.toMatch(/password|passwordHash|tokenHash/);
    const token = decodeURIComponent(cookie.split(";")[0].slice("cq_session=".length));
    const signedIn = { session, token };
    const restored = await sessionRoute(request("/api/auth/session", signedIn));
    expect(restored.status).toBe(200);
    expect((await restored.json()).data).toEqual(session);
    const logout = await logoutRoute(request("/api/auth/logout", signedIn, { method: "POST" }));
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await sessionRoute(request("/api/auth/session", signedIn))).status).toBe(401);
    expect((await employeeRoute(request("/api/employees/E0178", signedIn), context())).status).toBe(401);
  });

  it("does not store raw passwords or opaque session tokens in SQLite", () => {
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%'").all() as { name: string }[];
    expect(tables.length).toBeGreaterThan(0);
    const contents = JSON.stringify(tables.map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all()));
    expect(contents).not.toContain(TEST_PASSWORD);
    expect(contents).not.toContain(employee.token);
    expect(contents).not.toContain(hr.token);
  });

  it("rejects forged tokens and expires sessions after eight hours", async () => {
    const forged = { ...employee, token: "invalid-token" };
    expect((await sessionRoute(request("/api/auth/session", forged))).status).toBe(401);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000 + 1);
    expect((await sessionRoute(request("/api/auth/session", employee))).status).toBe(401);
  });

  it("immediately revokes access for a disabled account", async () => {
    getDatabase().prepare("UPDATE auth_users SET active=0 WHERE user_id=?").run(employee.session.user.id);
    const response = await sessionRoute(request("/api/auth/session", employee));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects ambiguous duplicate session cookies", async () => {
    const headers = authHeaders(employee);
    headers.set("Cookie", `cq_session=${employee.token}; cq_session=${hr.token}`);
    const response = await sessionRoute(new Request("http://localhost/api/auth/session", { headers }));
    expect(response.status).toBe(401);
  });

  it("throttles repeated invalid credentials and permits login after the limit window", async () => {
    const user = createUser({ username: "limited-login", password: TEST_PASSWORD, role: "employee", employeeId: "E0178" });
    const attempt = (password: string) => loginRoute(request("/api/auth/login", undefined, {
      ...jsonPost({ username: user.username, password }), headers: { "Origin": "http://localhost", "Content-Type": "application/json" },
    }));
    for (let index = 0; index < 5; index += 1) expect((await attempt("bad-password")).status).toBe(401);
    const blocked = await attempt(TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("LOGIN_RATE_LIMITED");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
    expect((await attempt(TEST_PASSWORD)).status).toBe(200);
  });

  it("marks cookies Secure when deployed with an HTTPS application origin", async () => {
    vi.stubEnv("APP_ORIGIN", "https://career.example");
    const user = createUser({ username: "https-login", password: TEST_PASSWORD, role: "employee", employeeId: "E0178" });
    const response = await loginRoute(new Request("https://career.example/api/auth/login", {
      ...jsonPost({ username: user.username, password: TEST_PASSWORD }), headers: { "Origin": "https://career.example", "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/; Secure/i);
  });

  it("returns a generic login error for unknown users and wrong passwords and rejects external login origins", async () => {
    const user = createUser({ username: "known-login", password: TEST_PASSWORD, role: "employee", employeeId: "E0178" });
    const bodies: unknown[] = [];
    for (const username of [user.username, "unknown-login"]) {
      const response = await loginRoute(request("/api/auth/login", undefined, {
        ...jsonPost({ username, password: "wrong-password" }), headers: { "Origin": "http://localhost", "Content-Type": "application/json" },
      }));
      expect(response.status).toBe(401);
      bodies.push(await response.json());
    }
    expect(bodies[0]).toEqual(bodies[1]);
    const external = await loginRoute(request("/api/auth/login", undefined, {
      ...jsonPost({ username: user.username, password: TEST_PASSWORD }), headers: { "Origin": "https://attacker.example", "Content-Type": "application/json" },
    }));
    expect(external.status).toBe(403);
    expect((await external.json()).error.code).toBe("ORIGIN_FORBIDDEN");
  });

  it("persists users and sessions through a database restart", async () => {
    closeDatabase();
    const response = await sessionRoute(request("/api/auth/session", employee));
    expect(response.status).toBe(200);
    expect((await response.json()).data.user).toEqual(employee.session.user);
  });

  it("lets HR provision an employee account and never returns its password hash", async () => {
    const response = await createAccountRoute(request("/api/hr/accounts", hr, jsonPost({
      username: "new-employee", password: TEST_PASSWORD, employeeId: "E0001",
    })));
    expect(response.status).toBe(201);
    const created = (await response.json()).data;
    expect(created).toMatchObject({ username: "new-employee", role: "employee", employeeId: "E0001" });
    expect(JSON.stringify(created)).not.toMatch(/password|hash/i);
    const accounts = await accountsRoute(request("/api/hr/accounts", hr));
    expect(accounts.status).toBe(200);
    expect(JSON.stringify(await accounts.json())).not.toMatch(/password|hash/i);
    const escalation = await createAccountRoute(request("/api/hr/accounts", hr, jsonPost({
      username: "injected-hr", password: TEST_PASSWORD, employeeId: "E0001", role: "hr",
    })));
    expect(escalation.status).toBe(422);
  });

  it("binds each issued session to its persisted user identity", async () => {
    const second = createSession(employee.session.user);
    const response = await employeeRoute(request("/api/employees/E0001", second), context("E0001"));
    expect(response.status).toBe(403);
    expect((await sessionRoute(request("/api/auth/session", second))).status).toBe(200);
  });
});

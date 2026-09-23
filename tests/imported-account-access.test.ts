import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listAccountsRoute, POST as createAccountRoute } from "@/app/api/hr/accounts/route";
import { POST as importRoute } from "@/app/api/import/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { GET as employeeRoute } from "@/app/api/employees/[employeeId]/route";
import { GET as employeesRoute } from "@/app/api/employees/route";
import { GET as hrRoute } from "@/app/api/hr/summary/route";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { authHeaders, TEST_PASSWORD, testIdentity, type TestIdentity } from "./helpers/auth";

const importedEmployeeId = "JURY_DEMO_001";
const importedEmployeeJson = fs.readFileSync("docs/fixtures/jury-employee.json", "utf8");
let temporaryDirectory: string;
let hr: TestIdentity;

beforeEach(async () => {
  closeDatabase();
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "career-imported-account-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(temporaryDirectory, "test.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_EXPLANATIONS_ENABLED", "false");
  vi.stubEnv("DEMO_EMPLOYEE_LOGIN", "false");
  hr = await testIdentity("hr");
});

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function accountCount(): number {
  return (getDatabase().prepare("SELECT COUNT(*) AS count FROM auth_users").get() as { count: number }).count;
}

function request(pathname: string, identity?: TestIdentity, init: RequestInit = {}): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    ...init,
    signal: init.signal ?? undefined,
    headers: identity ? authHeaders(identity, init.headers) : init.headers,
  });
}

async function importEmployee() {
  const form = new FormData();
  form.set("employees", new File([importedEmployeeJson], "jury-employee.json", { type: "application/json" }));
  const response = await importRoute(request("/api/import", hr, { method: "POST", body: form }));
  expect(response.status).toBe(201);
  expect((await response.json()).data).toMatchObject({ employeesInserted: 1, employeeIds: [importedEmployeeId] });
}

function createAccount(body: unknown, identity: TestIdentity | undefined = hr) {
  return createAccountRoute(request("/api/hr/accounts", identity, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

async function signIn(username: string): Promise<TestIdentity> {
  const response = await loginRoute(request("/api/auth/login", undefined, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  }));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toMatch(/HttpOnly/i);
  const token = cookie.split(";")[0].slice("cq_session=".length);
  return { session: (await response.json()).data, token };
}

async function profile(identity: TestIdentity, employeeId = importedEmployeeId) {
  return employeeRoute(request(`/api/employees/${employeeId}`, identity), { params: Promise.resolve({ employeeId }) });
}

describe("individual access for HR-imported employee profiles", () => {
  it("imports, provisions through the HR endpoint, logs in, and limits the new account to its own profile", async () => {
    const before = accountCount();
    await importEmployee();
    expect(databaseCounts().employees).toBe(201);
    expect(accountCount()).toBe(before);

    const response = await createAccount({ username: "  Imported.Employee  ", password: TEST_PASSWORD, employeeId: importedEmployeeId });
    expect(response.status).toBe(201);
    const created = (await response.json()).data;
    expect(created).toEqual({ id: expect.any(String), username: "imported.employee", role: "employee", employeeId: importedEmployeeId });
    expect(accountCount()).toBe(before + 1);

    const listing = await listAccountsRoute(request("/api/hr/accounts", hr));
    expect(listing.status).toBe(200);
    const accountList = await listing.json();
    expect(accountList.data.items).toEqual(expect.arrayContaining([{ ...created, active: true }]));
    expect(JSON.stringify(accountList)).not.toMatch(/password|password_hash|token_hash/i);
    expect(JSON.stringify(accountList)).not.toContain(TEST_PASSWORD);

    const employee = await signIn("imported.employee");
    expect(employee.session.user).toEqual(created);
    const restored = await sessionRoute(request("/api/auth/session", employee));
    expect(restored.status).toBe(200);
    expect((await restored.json()).data).toEqual(employee.session);
    const ownProfile = await profile(employee);
    expect(ownProfile.status).toBe(200);
    expect((await ownProfile.json()).data).toMatchObject({ employee: { employee_id: importedEmployeeId }, readiness: 71.3, activityHistory: [] });
    const ownList = await employeesRoute(request("/api/employees", employee));
    expect((await ownList.json()).data).toMatchObject({ total: 1, items: [{ employeeId: importedEmployeeId }] });
    expect((await profile(employee, "E0178")).status).toBe(403);
    expect((await hrRoute(request("/api/hr/summary", employee))).status).toBe(403);
    expect((await listAccountsRoute(request("/api/hr/accounts", employee))).status).toBe(403);
    expect((await sessionRoute(request("/api/auth/session", hr))).status).toBe(200);
  });

  it("rejects a missing employee without inserting an auth row", async () => {
    const before = accountCount();
    const response = await createAccount({ username: "missing-employee", password: TEST_PASSWORD, employeeId: "UNKNOWN_IMPORTED_EMPLOYEE" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("EMPLOYEE_NOT_FOUND");
    expect(accountCount()).toBe(before);
    expect(getDatabase().prepare("SELECT 1 FROM auth_users WHERE username=?").get("missing-employee")).toBeUndefined();
  });

  it("rejects role injection instead of creating a privileged account", async () => {
    await importEmployee();
    const before = accountCount();
    const response = await createAccount({ username: "attempted-hr", password: TEST_PASSWORD, employeeId: importedEmployeeId, role: "hr" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(accountCount()).toBe(before);
  });

  it("denies account creation by an employee even with a valid session and CSRF token", async () => {
    const employee = await testIdentity("employee", "E0178");
    const before = accountCount();
    const response = await createAccount({ username: "unauthorized-account", password: TEST_PASSWORD, employeeId: "E0178" }, employee);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(accountCount()).toBe(before);
  });

  it("returns a case-insensitive username conflict without creating a duplicate", async () => {
    await importEmployee();
    const input = { username: "linked.employee", password: TEST_PASSWORD, employeeId: importedEmployeeId };
    expect((await createAccount(input)).status).toBe(201);
    const before = accountCount();
    const duplicate = await createAccount({ ...input, username: "  LINKED.EMPLOYEE  " });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("USERNAME_EXISTS");
    expect(accountCount()).toBe(before);
  });

  it("validates the strict account payload and 12–128 character password bounds", async () => {
    const input = { username: "valid-user", password: TEST_PASSWORD, employeeId: "E0178" };
    const before = accountCount();
    for (const invalid of [
      { ...input, username: "ab" },
      { ...input, username: "invalid user" },
      { ...input, username: "a".repeat(81) },
      { ...input, password: "x".repeat(11) },
      { ...input, password: "x".repeat(129) },
      { ...input, employeeId: "" },
      { ...input, active: true },
    ]) {
      const response = await createAccount(invalid);
      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatchObject({ code: "VALIDATION_ERROR", details: expect.any(Array) });
    }
    expect(accountCount()).toBe(before);
    expect((await createAccount({ ...input, username: "minimum-password", password: "x".repeat(12) })).status).toBe(201);
    expect((await createAccount({ ...input, username: "maximum-password", password: "x".repeat(128) })).status).toBe(201);
  });

  it("requires authentication and CSRF before inserting an account", async () => {
    const input = { username: "protected-account", password: TEST_PASSWORD, employeeId: "E0178" };
    const before = accountCount();
    const anonymous = await createAccountRoute(request("/api/hr/accounts", undefined, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }));
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("AUTH_REQUIRED");
    const headers = authHeaders(hr, { "Content-Type": "application/json" });
    headers.delete("X-CSRF-Token");
    const noCsrf = await createAccountRoute(new Request("http://localhost/api/hr/accounts", {
      method: "POST", headers, body: JSON.stringify(input),
    }));
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("CSRF_INVALID");
    expect(accountCount()).toBe(before);
  });

  it("preserves the imported profile, account, and authenticated access after reopening SQLite", async () => {
    await importEmployee();
    const response = await createAccount({ username: "persistent-import", password: TEST_PASSWORD, employeeId: importedEmployeeId });
    expect(response.status).toBe(201);
    const created = (await response.json()).data;
    const employee = await signIn("persistent-import");
    closeDatabase();

    const restoredProfile = await profile(employee);
    expect(restoredProfile.status).toBe(200);
    expect((await restoredProfile.json()).data.employee.employee_id).toBe(importedEmployeeId);
    const accounts = await listAccountsRoute(request("/api/hr/accounts", hr));
    expect(accounts.status).toBe(200);
    expect((await accounts.json()).data.items).toEqual(expect.arrayContaining([{ ...created, active: true }]));
    expect((await signIn("persistent-import")).session.user).toEqual(created);
    expect(databaseCounts().employees).toBe(201);
  });
});

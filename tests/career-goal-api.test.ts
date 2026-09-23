import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as goalRoute } from "@/app/api/employees/[employeeId]/career-goal/route";
import { GET as employeeRoute } from "@/app/api/employees/[employeeId]/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import type { EmployeeDetail } from "@/contracts/api";
import { getEmployeeView } from "@/lib/recommendation";
import { normalizeDataset } from "@/lib/data/normalize";
import * as openAiProvider from "@/lib/ai/openai-explainer";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { loadDomainDataset } from "@/server/repositories";
import { authHeaders, testIdentity, type TestIdentity } from "./helpers/auth";

const employeeId = "E0178";
const newGoal = { target_role: "Product Manager", target_grade: "Senior" as const };
let directory: string;
let employee: TestIdentity;
let hr: TestIdentity;
let network: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  closeDatabase();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-goal-api-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "test.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  vi.stubEnv("DEMO_EMPLOYEE_LOGIN", "false");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_EXPLANATIONS_ENABLED", "true");
  employee = await testIdentity("employee", employeeId);
  hr = await testIdentity("hr");
  network = vi.fn(() => { throw new Error("Career goal updates must not invoke external services"); });
  vi.stubGlobal("fetch", network);
  vi.spyOn(openAiProvider, "createOpenAIExplainer");
});

afterEach(() => {
  closeDatabase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function storedState() {
  const db = getDatabase();
  return {
    employees: db.prepare("SELECT * FROM employees ORDER BY employee_id").all() as Array<Record<string, unknown>>,
    history: db.prepare("SELECT * FROM activity_history ORDER BY record_id").all(),
    accounts: db.prepare("SELECT user_id,username,role,employee_id,active FROM auth_users ORDER BY user_id").all(),
    roleProfiles: db.prepare("SELECT * FROM role_profiles ORDER BY role,grade").all(),
    audit: db.prepare("SELECT * FROM auth_audit ORDER BY audit_id").all(),
  };
}

function patch(body: unknown, identity: TestIdentity | null = employee, id = employeeId, changeHeaders?: (headers: Headers) => void) {
  const headers = identity
    ? authHeaders(identity, { "Content-Type": "application/json" })
    : new Headers({ "Content-Type": "application/json", Origin: "http://localhost" });
  changeHeaders?.(headers);
  return goalRoute(new Request(`http://localhost/api/employees/${id}/career-goal`, {
    method: "PATCH", headers, body: JSON.stringify(body),
  }), { params: Promise.resolve({ employeeId: id }) });
}

async function detail(identity = employee, id = employeeId): Promise<EmployeeDetail> {
  const response = await employeeRoute(new Request(`http://localhost/api/employees/${id}`, { headers: authHeaders(identity) }), {
    params: Promise.resolve({ employeeId: id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect((await response.json()).error.code).toBe(code);
}

describe("self-service career goal API", () => {
  it("updates only career_goal_json and returns the deterministic recalculated EmployeeDetail", async () => {
    const before = storedState();
    const beforeView = await detail();
    const source = loadDomainDataset(getDatabase());
    const expected = getEmployeeView(normalizeDataset({
      ...source,
      employees: source.employees.map((item) => item.employee_id === employeeId ? { ...item, career_goal: newGoal } : item),
    }), employeeId);

    const response = await patch({ career_goal: newGoal });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const updated: EmployeeDetail = (await response.json()).data;
    expect(updated).toMatchObject(expected);
    expect(updated.target).toEqual({ role: "Product Manager", grade: "Senior" });
    expect(updated.activityHistory).toEqual(beforeView.activityHistory);
    expect(updated.completedActivities).toEqual(beforeView.completedActivities);
    expect(updated.activeMandatoryObligations).toEqual(beforeView.activeMandatoryObligations);
    expect(updated.employee.skills).toEqual(beforeView.employee.skills);
    expect(updated.effectiveSkills).toEqual(beforeView.effectiveSkills);
    expect(updated.recommendations.every((item) => item.explanationSource === "fallback")).toBe(true);
    expect(updated.recommendationDiagnostics.snapshotDate).toBe("2026-10-01");
    expect(await detail()).toEqual(updated);

    const after = storedState();
    expect(after.employees).toEqual(before.employees.map((row) => row.employee_id === employeeId
      ? { ...row, career_goal_json: JSON.stringify(newGoal) } : row));
    expect(after.history).toEqual(before.history);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.roleProfiles).toEqual(before.roleProfiles);
    expect(after.audit).toHaveLength(before.audit.length + 1);
    expect(after.audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: "career_goal.updated", target_id: employeeId, user_id: employee.session.user.id })]));
    expect(network).not.toHaveBeenCalled();
    expect(openAiProvider.createOpenAIExplainer).not.toHaveBeenCalled();
  });

  it("clears an explicit goal with null and restores the default next-grade trajectory", async () => {
    expect((await patch({ career_goal: newGoal })).status).toBe(200);
    const source = loadDomainDataset(getDatabase());
    const expected = getEmployeeView(normalizeDataset({
      ...source,
      employees: source.employees.map((item) => item.employee_id === employeeId ? { ...item, career_goal: null } : item),
    }), employeeId);
    const before = storedState();
    const response = await patch({ career_goal: null });
    expect(response.status).toBe(200);
    const updated: EmployeeDetail = (await response.json()).data;
    expect(updated).toMatchObject(expected);
    expect(updated.employee.career_goal).toBeNull();
    expect(updated.target).toEqual({ role: "Backend Engineer", grade: "Senior" });
    const after = storedState();
    expect(after.employees).toEqual(before.employees.map((row) => row.employee_id === employeeId ? { ...row, career_goal_json: null } : row));
    expect(after.history).toEqual(before.history);
    expect(after.accounts).toEqual(before.accounts);
    expect(network).not.toHaveBeenCalled();
    expect(openAiProvider.createOpenAIExplainer).not.toHaveBeenCalled();
  });

  it("returns INVALID_CAREER_TARGET for a role/grade pair absent from the catalog without mutation", async () => {
    const before = storedState();
    await expectError(await patch({ career_goal: { target_role: "Unknown Career Role", target_grade: "Senior" } }), 422, "INVALID_CAREER_TARGET");
    expect(storedState()).toEqual(before);
  });

  it("rejects assessed-skill, current-position and rights changes including extra inner goal properties", async () => {
    const before = storedState();
    const inputs = [
      { career_goal: newGoal, skills: { SK_SYSTEM_DESIGN: 5 } },
      { career_goal: newGoal, assessedSkills: { SK_SYSTEM_DESIGN: 5 } },
      { career_goal: newGoal, role: "hr" },
      { career_goal: newGoal, grade: "Lead" },
      { career_goal: newGoal, rights: ["hr"] },
      { career_goal: newGoal, employee_id: "E0001" },
      { career_goal: { ...newGoal, role: "hr" } },
      { career_goal: { ...newGoal, required_skills: { SK_SYSTEM_DESIGN: 0 } } },
      { career_goal: { ...newGoal, target_grade: "Principal" } },
      {},
    ];
    for (const input of inputs) {
      await expectError(await patch(input), 422, "VALIDATION_ERROR");
      expect(storedState()).toEqual(before);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it("forbids other employees and HR from changing the employee's career goal", async () => {
    const before = storedState();
    for (const id of ["E0001", "MISSING_EMPLOYEE"]) {
      await expectError(await patch({ career_goal: newGoal }, employee, id), 403, "FORBIDDEN");
    }
    await expectError(await patch({ career_goal: newGoal }, hr), 403, "FORBIDDEN");
    expect(storedState()).toEqual(before);
  });

  it("requires authentication, same-origin and the current session's CSRF token", async () => {
    const before = storedState();
    await expectError(await patch({ career_goal: newGoal }, null), 401, "AUTH_REQUIRED");
    await expectError(await patch({ career_goal: newGoal }, employee, employeeId, (headers) => headers.delete("X-CSRF-Token")), 403, "CSRF_INVALID");
    await expectError(await patch({ career_goal: newGoal }, employee, employeeId, (headers) => headers.set("X-CSRF-Token", hr.session.csrfToken)), 403, "CSRF_INVALID");
    await expectError(await patch({ career_goal: newGoal }, employee, employeeId, (headers) => headers.set("Origin", "https://external.example")), 403, "ORIGIN_FORBIDDEN");
    expect(storedState()).toEqual(before);
  });

  it("persists the goal and recalculated view after reopening SQLite without changing session rights", async () => {
    const response = await patch({ career_goal: newGoal });
    expect(response.status).toBe(200);
    const updated = (await response.json()).data;
    const beforeRestart = storedState();
    closeDatabase();
    expect(await detail()).toEqual(updated);
    expect(storedState()).toEqual(beforeRestart);
    const session = await sessionRoute(new Request("http://localhost/api/auth/session", { headers: authHeaders(employee) }));
    expect(session.status).toBe(200);
    expect((await session.json()).data).toEqual(employee.session);
  });

  it("rolls back the goal when its audit entry cannot be saved", async () => {
    const db = getDatabase();
    const before = storedState();
    const previousView = await detail();
    db.exec(`CREATE TEMP TRIGGER fail_goal_audit BEFORE INSERT ON auth_audit
      WHEN NEW.action = 'career_goal.updated'
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectError(await patch({ career_goal: newGoal }), 500, "INTERNAL_ERROR");
    expect(storedState()).toEqual(before);
    expect(await detail()).toEqual(previousView);
  });

  it("rolls back the new goal if rebuilding EmployeeDetail fails after the SQL update", async () => {
    const db = getDatabase();
    const before = storedState();
    const previousView = await detail();
    // Fail the repository read during projection, after the goal update has actually executed.
    db.exec(`CREATE TEMP TRIGGER fail_goal_projection AFTER UPDATE OF career_goal_json ON employees
      WHEN NEW.employee_id = 'E0178'
      BEGIN
        UPDATE role_profiles SET required_skills_json = 'not-valid-json' WHERE role = 'Product Manager' AND grade = 'Senior';
      END;`);
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectError(await patch({ career_goal: newGoal }), 500, "INTERNAL_ERROR");
    expect(loggedError).toHaveBeenCalled();
    expect(storedState()).toEqual(before);
    expect(await detail()).toEqual(previousView);
    expect(network).not.toHaveBeenCalled();
  });
});

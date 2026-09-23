import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteActivityResult, EmployeeDetail } from "@/contracts/api";
import { POST as completionRoute } from "@/app/api/employees/[employeeId]/activities/[eventId]/complete/route";
import { GET as profileRoute } from "@/app/api/employees/[employeeId]/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { ActivityRepository, EmployeeRepository, loadDomainDataset } from "@/server/repositories";
import { authHeaders, testIdentity, type TestIdentity } from "./helpers/auth";

const EMPLOYEE_ID = "E0178";
let directory: string;
let employee: TestIdentity;
let hr: TestIdentity;

beforeEach(async () => {
  closeDatabase();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-completion-eligibility-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "completion.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_EXPLANATIONS_ENABLED", "false");
  vi.stubEnv("DEMO_EMPLOYEE_LOGIN", "false");
  employee = await testIdentity("employee", EMPLOYEE_ID);
  hr = await testIdentity("hr");
});

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function profile(employeeId = EMPLOYEE_ID, identity = employee): Promise<EmployeeDetail> {
  const response = await profileRoute(new Request(`http://localhost/api/employees/${employeeId}`, {
    headers: authHeaders(identity),
  }), { params: Promise.resolve({ employeeId }) });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

function complete(eventId: string, body: object = {}, identity: TestIdentity = employee, employeeId = EMPLOYEE_ID) {
  const headers = authHeaders(identity, { "Content-Type": "application/json" });
  return completionRoute(new Request(`http://localhost/api/employees/${employeeId}/activities/${eventId}/complete`, {
    method: "POST", headers, body: JSON.stringify(body),
  }), { params: Promise.resolve({ employeeId, eventId }) });
}

async function storedState() {
  return {
    counts: databaseCounts(),
    history: new ActivityRepository().listAll(),
    assessedSkills: new EmployeeRepository().getById(EMPLOYEE_ID)!.skills,
    profile: await profile(),
  };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect((await response.json()).error).toMatchObject({ code });
}

describe("activity completion API enforces eligibility before persisting progress", () => {
  it.each([
    { label: "without a date", body: {} },
    { label: "with an explicit valid session date", body: { completedAt: "2026-10-07" } },
  ])("rejects E0178/EV_006 $label and leaves all history and skills unchanged", async ({ body }) => {
    const before = await storedState();
    expect(before.profile.readiness).toBe(71.3);
    const response = await complete("EV_006", body);
    await expectError(response, 422, "EVENT_NOT_ELIGIBLE");
    expect(await storedState()).toEqual(before);
  });

  it("rejects a non-session completion date even when the scheduled activity is otherwise eligible", async () => {
    const before = await storedState();
    expect(before.profile.recommendations.some((item) => item.eventId === "EV_005")).toBe(true);
    const response = await complete("EV_005", { completedAt: "2026-10-02" });
    expect(response.status).toBe(422);
    const error = (await response.json()).error;
    expect(error.code).toBe("EVENT_NOT_ELIGIBLE");
    expect(error.details).toContainEqual(expect.objectContaining({ field: "completedAt" }));
    expect(await storedState()).toEqual(before);
  });

  it("rolls back the inserted history and every business record if recomputing the profile fails", async () => {
    const before = await storedState();
    const businessRecords = loadDomainDataset();
    const db = getDatabase();
    db.exec(`
      CREATE TEMP TRIGGER fail_completion_projection AFTER INSERT ON activity_history
      WHEN NEW.employee_id = 'E0178' AND NEW.event_id = 'EV_005'
      BEGIN
        UPDATE employees SET skills_json = 'invalid-json' WHERE employee_id = 'E0178';
      END;
    `);
    const expectedError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expectError(await complete("EV_005"), 500, "INTERNAL_ERROR");
      expect(expectedError).toHaveBeenCalledTimes(1);
      expect(await storedState()).toEqual(before);
      expect(loadDomainDataset()).toEqual(businessRecords);
    } finally {
      expectedError.mockRestore();
      db.exec("DROP TRIGGER IF EXISTS temp.fail_completion_projection");
    }
  });

  it("completes an eligible activity once, recalculates progress, and preserves the session and progress after reopening SQLite", async () => {
    const before = await storedState();
    expect(before.profile.readiness).toBe(71.3);
    expect(before.profile.recommendations.some((item) => item.eventId === "EV_005")).toBe(true);
    const response = await complete("EV_005");
    expect(response.status).toBe(201);
    const result: CompleteActivityResult = (await response.json()).data;
    expect(result.activity).toMatchObject({ employee_id: EMPLOYEE_ID, event_id: "EV_005", status: "completed", completion_pct: 100, assigned_by: "self" });
    expect(result.activity.record_id).toMatch(/^LOCAL_[0-9a-f-]{36}$/);
    expect(result.progress).toEqual({ before: 71.3, after: 74.1, delta: 2.8 });
    expect(result.view.readiness).toBe(74.1);
    expect(result.view.employee.skills).toEqual(before.assessedSkills);
    const after = await storedState();
    expect(after.counts.activityHistory).toBe(before.counts.activityHistory + 1);
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.history).toContainEqual(result.activity);
    expect(after.assessedSkills).toEqual(before.assessedSkills);
    expect(after.profile).toEqual(result.view);
    const expectedAudit = [{ user_id: employee.session.user.id, action: "activity.completed", target_id: result.activity.record_id }];
    const completionAudits = () => getDatabase().prepare("SELECT user_id, action, target_id FROM auth_audit WHERE action='activity.completed'").all();
    expect(completionAudits()).toEqual(expectedAudit);

    await expectError(await complete("EV_005"), 409, "EVENT_ALREADY_COMPLETED");
    expect(await storedState()).toEqual(after);
    expect(completionAudits()).toEqual(expectedAudit);

    closeDatabase();
    const session = await sessionRoute(new Request("http://localhost/api/auth/session", { headers: authHeaders(employee) }));
    expect(session.status).toBe(200);
    expect((await session.json()).data).toEqual(employee.session);
    expect(await profile()).toEqual(result.view);
    expect(await storedState()).toEqual(after);
    expect(completionAudits()).toEqual(expectedAudit);
  });

  it("rolls back completion and progress when its audit record cannot be saved", async () => {
    const before = await storedState();
    const businessRecords = loadDomainDataset();
    const db = getDatabase();
    const auditBefore = db.prepare("SELECT * FROM auth_audit ORDER BY audit_id").all();
    db.exec(`
      CREATE TEMP TRIGGER fail_completion_audit BEFORE INSERT ON auth_audit
      WHEN NEW.action = 'activity.completed'
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END;
    `);
    const expectedError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expectError(await complete("EV_005"), 500, "INTERNAL_ERROR");
      expect(expectedError).toHaveBeenCalledTimes(1);
      expect(await storedState()).toEqual(before);
      expect(loadDomainDataset()).toEqual(businessRecords);
      expect(db.prepare("SELECT * FROM auth_audit ORDER BY audit_id").all()).toEqual(auditBefore);
    } finally {
      expectedError.mockRestore();
      db.exec("DROP TRIGGER IF EXISTS temp.fail_completion_audit");
    }
  });

  it("rejects another employee's completion and does not reveal whether a foreign profile exists", async () => {
    const before = await storedState();
    for (const employeeId of ["E0001", "MISSING_EMPLOYEE"]) {
      await expectError(await complete("EV_005", {}, employee, employeeId), 403, "FORBIDDEN");
      expect(await storedState()).toEqual(before);
    }
  });

  it("forbids HR from completing an employee's activity", async () => {
    const before = await storedState();
    await expectError(await complete("EV_005", {}, hr), 403, "FORBIDDEN");
    expect(await storedState()).toEqual(before);
  });

  it("requires an authenticated session before accepting a completion", async () => {
    const before = await storedState();
    const response = await completionRoute(new Request(`http://localhost/api/employees/${EMPLOYEE_ID}/activities/EV_005/complete`, {
      method: "POST", headers: { "Content-Type": "application/json", "Origin": "http://localhost" }, body: "{}",
    }), { params: Promise.resolve({ employeeId: EMPLOYEE_ID, eventId: "EV_005" }) });
    await expectError(response, 401, "AUTH_REQUIRED");
    expect(await storedState()).toEqual(before);
  });

  it("returns 404 for an unknown event in the employee's own profile without changing data", async () => {
    const before = await storedState();
    await expectError(await complete("EV_UNKNOWN"), 404, "EVENT_NOT_FOUND");
    expect(await storedState()).toEqual(before);
  });

  it.each(["hr", "manager"] as const)("requires an active mandatory assignment and preserves its %s source when completing", async (assignedBy) => {
    const employeeId = `MANDATORY_${assignedBy.toUpperCase()}`;
    const sourceProfile = new EmployeeRepository().getById(EMPLOYEE_ID)!;
    new EmployeeRepository().upsert({ ...sourceProfile, employee_id: employeeId });
    const identity = await testIdentity("employee", employeeId);
    const beforeAssignment = loadDomainDataset();
    const refused = await complete("EV_001", {}, identity, employeeId);
    expect(refused.status).toBe(422);
    const error = (await refused.json()).error;
    expect(error.code).toBe("EVENT_NOT_ELIGIBLE");
    expect(error.details).toContainEqual(expect.objectContaining({ message: expect.stringContaining("mandatory_assignment_required") }));
    expect(loadDomainDataset()).toEqual(beforeAssignment);

    new ActivityRepository().insert({
      record_id: `MANDATORY_ASSIGNMENT_${assignedBy.toUpperCase()}`,
      employee_id: employeeId, event_id: "EV_001", date: "2026-09-20", due_date: "2026-09-30",
      status: assignedBy === "hr" ? "overdue" : "in_progress", completion_pct: 40,
      score: null, feedback_rating: null, assigned_by: assignedBy,
    });
    const assignedProfile = await profile(employeeId, identity);
    const beforeCompletion = databaseCounts().activityHistory;
    expect(assignedProfile.activeMandatoryObligations).toHaveLength(1);
    const response = await complete("EV_001", {}, identity, employeeId);
    expect(response.status).toBe(201);
    const result: CompleteActivityResult = (await response.json()).data;
    expect(result.activity).toMatchObject({ employee_id: employeeId, event_id: "EV_001", date: "2026-10-01", status: "completed", assigned_by: assignedBy });
    expect(databaseCounts().activityHistory).toBe(beforeCompletion + 1);
    expect(new ActivityRepository().listByEmployee(employeeId)).toContainEqual(result.activity);
    expect(result.view.employee.skills).toEqual(sourceProfile.skills);
    expect(result.view.readiness).toBe(assignedProfile.readiness);
    expect(result.view.activeMandatoryObligations).toEqual([]);
    expect(result.view.recommendations.every((item) => item.eventId !== "EV_001")).toBe(true);
  });

  it("rejects an arbitrary future date for a self-paced activity without writing history", async () => {
    const employeeId = "SELF_PACED_DATE";
    new EmployeeRepository().upsert({ ...new EmployeeRepository().getById(EMPLOYEE_ID)!, employee_id: employeeId });
    const identity = await testIdentity("employee", employeeId);
    new ActivityRepository().insert({
      record_id: "SELF_PACED_ASSIGNMENT", employee_id: employeeId, event_id: "EV_001",
      date: "2026-09-20", due_date: "2026-10-10", status: "in_progress", completion_pct: 40,
      score: null, feedback_rating: null, assigned_by: "hr",
    });
    const before = loadDomainDataset();
    const originalProfile = await profile(employeeId, identity);
    const response = await complete("EV_001", { completedAt: "2026-10-02" }, identity, employeeId);
    expect(response.status).toBe(422);
    const error = (await response.json()).error;
    expect(error.code).toBe("EVENT_NOT_ELIGIBLE");
    expect(error.details).toContainEqual(expect.objectContaining({ field: "completedAt", message: expect.stringContaining("invalid_completion_date") }));
    expect(loadDomainDataset()).toEqual(before);
    expect(await profile(employeeId, identity)).toEqual(originalProfile);
  });
});

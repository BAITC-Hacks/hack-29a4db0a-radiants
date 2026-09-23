import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { databaseCounts, closeDatabase, getDatabase } from "@/server/db/database";
import { EmployeeRepository, EventRepository } from "@/server/repositories";
import { completeActivity, getEmployeeProjection, getRecommendations, getHrSummary } from "@/server/services/career-quest";
import { importData } from "@/server/services/import";
import { AppError } from "@/server/errors";
import { GET as employeeListRoute } from "@/app/api/employees/route";
import { GET as employeeRoute } from "@/app/api/employees/[employeeId]/route";
import { POST as completionRoute } from "@/app/api/employees/[employeeId]/activities/[eventId]/complete/route";
import { POST as importRoute } from "@/app/api/import/route";
import { createCareerApi } from "@/lib/frontend/api";
import { authHeaders, testIdentity, type TestIdentity } from "./helpers/auth";

let temporaryDirectory: string;
let hrIdentity: TestIdentity;
let employeeIdentity: TestIdentity;

beforeEach(async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  closeDatabase();
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "career-quest-test-"));
  process.env.CAREER_QUEST_DB_PATH = path.join(temporaryDirectory, "test.sqlite");
  process.env.CAREER_QUEST_DATA_DIR = path.resolve(process.cwd(), "data");
  hrIdentity = await testIdentity();
  employeeIdentity = await testIdentity("employee", "E0178");
});

afterEach(() => {
  vi.unstubAllEnvs();
  closeDatabase();
  delete process.env.CAREER_QUEST_DB_PATH;
  delete process.env.CAREER_QUEST_DATA_DIR;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Career Quest backend", () => {
  it("connects the teammate frontend transport to real route handlers and SQLite", async () => {
    const fetcher: typeof fetch = async (url, init) => {
      const identity = String(url).includes("/activities/") ? employeeIdentity : hrIdentity;
      const request = new NextRequest("http://localhost" + String(url), { ...init, signal: init?.signal ?? undefined, headers: authHeaders(identity, init?.headers) });
      const parts = request.nextUrl.pathname.split("/");
      if (parts[2] === "import") return importRoute(request);
      if (!parts[3]) return employeeListRoute(request);
      const employeeId = decodeURIComponent(parts[3]);
      if (parts[4] === "activities") return completionRoute(request, { params: Promise.resolve({ employeeId, eventId: decodeURIComponent(parts[5]) }) });
      return employeeRoute(request, { params: Promise.resolve({ employeeId }) });
    };
    const api = createCareerApi({ fetcher });
    expect(await api.getEmployees()).toHaveLength(200);
    expect((await api.getEmployeeView("E0178")).readiness).toBe(71.3);
    expect((await api.completeActivity("E0178", "EV_005")).readiness).toBe(74.1);
    const employee = { ...new EmployeeRepository().getById("E0001")!, employee_id: "TRANSPORT_IMPORT" };
    const imported = await api.importData(new File([JSON.stringify(employee)], "employee.json"));
    expect(imported.employeeIds).toEqual(["TRANSPORT_IMPORT"]);
    expect((await api.getEmployeeView("TRANSPORT_IMPORT")).employee.employee_id).toBe("TRANSPORT_IMPORT");
  });
  it("creates and seeds SQLite idempotently", () => {
    const db = getDatabase();
    expect(databaseCounts(db)).toEqual({
      skills: 60,
      roleProfiles: 32,
      employees: 200,
      events: 40,
      activityHistory: 2743,
    });
    expect(databaseCounts(getDatabase()).activityHistory).toBe(2743);
    closeDatabase();
    expect(databaseCounts(getDatabase()).activityHistory).toBe(2743);
  });

  it("migrates a version 1 database without replacing employee progress or history", async () => {
    const db = getDatabase();
    const completion = await completeActivity("E0178", "EV_005", {}, db);
    const before = databaseCounts(db);
    const assessed = new EmployeeRepository(db).getById("E0178")!.skills;
    // Recreate the previous release's schema using only this disposable test database.
    db.exec("DROP TABLE auth_sessions; DROP TABLE auth_users; DROP TABLE auth_login_attempts; DROP TABLE auth_audit; DELETE FROM schema_migrations WHERE version=2;");
    closeDatabase();
    const upgraded = getDatabase();
    expect(upgraded.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }]);
    expect(databaseCounts(upgraded)).toEqual(before);
    expect(new EmployeeRepository(upgraded).getById("E0178")!.skills).toEqual(assessed);
    expect(getEmployeeProjection("E0178", upgraded).readiness).toBe(74.1);
    expect(upgraded.prepare("SELECT record_id FROM activity_history WHERE record_id=?").get(completion.activity.record_id)).toEqual({ record_id: completion.activity.record_id });
    expect(upgraded.prepare("SELECT COUNT(*) AS count FROM auth_users").get()).toEqual({ count: 0 });
  });

  it("builds a projection and only returns voluntary recommendations", async () => {
    getDatabase();
    const projection = getEmployeeProjection("E0001");
    expect(projection.employee.employee_id).toBe("E0001");
    expect(projection.target).not.toBeNull();
    expect(projection.readiness).toBeTypeOf("number");
    const result = await getRecommendations("E0001");
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
    for (const recommendation of result.recommendations) {
      expect(new EventRepository().getById(recommendation.eventId)!.mandatory).toBe(false);
      expect(recommendation.reasons.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("persists completion and rejects a duplicate non-repeatable event", async () => {
    const db = getDatabase();
    const employees = new EmployeeRepository(db).list();
    let selected: { employeeId: string; eventId: string } | null = null;
    for (const employee of employees) {
      const recommendations = await getRecommendations(employee.employee_id, db);
      const recommendation = recommendations.recommendations.find(
        (item) => item.eventId !== "EV_036",
      );
      if (recommendation) {
        selected = { employeeId: employee.employee_id, eventId: recommendation.eventId };
        break;
      }
    }
    expect(selected).not.toBeNull();
    const before = databaseCounts(db).activityHistory;
    const previousProjection = getEmployeeProjection(selected!.employeeId, db);
    const completed = await completeActivity(selected!.employeeId, selected!.eventId, {}, db);
    expect(completed.view.effectiveSkills).not.toEqual(previousProjection.effectiveSkills);
    expect(completed.activity.record_id).toMatch(/^LOCAL_[0-9a-f-]{36}$/);
    expect(completed.view.recommendations.some((item) => item.eventId === selected!.eventId)).toBe(false);
    expect(databaseCounts(db).activityHistory).toBe(before + 1);
    await expect(completeActivity(selected!.employeeId, selected!.eventId, {}, db)).rejects.toMatchObject({
      status: 409,
      code: "EVENT_ALREADY_COMPLETED",
    });
  });

  it("reimports the official files without duplicating history", () => {
    const db = getDatabase();
    const result = importData({
      employeesJson: fs.readFileSync("data/employees.json", "utf8"),
      historyCsv: fs.readFileSync("data/activity_history.csv", "utf8"),
    }, db);
    expect(result).toEqual({ employeesInserted: 0, employeesUpdated: 200, historyInserted: 0, historySkipped: 2743 });
    expect(databaseCounts(db).activityHistory).toBe(2743);
  });

  it("matches PR 1 progress validation and never double-applies assessed skill gains", async () => {
    const db = getDatabase();
    const assessedBefore = new EmployeeRepository(db).getById("E0178")!.skills;
    const before = getEmployeeProjection("E0178", db);
    expect(before.readiness).toBe(71.3);
    expect(before.recommendations[0].eventId).toBe("EV_005");
    const result = await completeActivity("E0178", "EV_005", {}, db);
    expect(result.progress).toEqual({ before: 71.3, after: 74.1, delta: 2.8 });
    expect(new EmployeeRepository(db).getById("E0178")!.skills).toEqual(assessedBefore);
    for (const change of before.recommendations[0].expectedChanges) {
      expect(result.view.effectiveSkills[change.skillId]).toBe(change.after);
    }
    expect(result.view.effectiveSkills.SK_API_DESIGN).toBe(4);
    closeDatabase();
    expect(getEmployeeProjection("E0178").readiness).toBe(74.1);
  });

  it("supports independent HR filters and keeps engagement out of employee cards", async () => {
    const employees = new EmployeeRepository().list();
    for (const filter of [{ role: "Backend Engineer" }, { grade: "Lead" as const }, { department: "Data & Analytics" }]) {
      const expected = employees.filter((employee) => Object.entries(filter).every(([key, value]) => employee[key as keyof typeof employee] === value));
      expect(getHrSummary(filter).population).toBe(expected.length);
    }
    const response = await employeeListRoute(new NextRequest("http://localhost/api/employees?grade=Lead", { headers: authHeaders(hrIdentity) }));
    const body = await response.json();
    expect(body.data.items.every((item: { grade: string }) => item.grade === "Lead")).toBe(true);
    expect(body.data.items[0]).not.toHaveProperty("activities");
    expect(body.data.items[0]).not.toHaveProperty("participationByStatus");
  });

  it("returns structured HTTP errors for missing employees and invalid input", async () => {
    const missing = await employeeRoute(new Request("http://localhost/api/employees/missing", { headers: authHeaders(hrIdentity) }), { params: Promise.resolve({ employeeId: "missing" }) });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("EMPLOYEE_NOT_FOUND");
    expect((await employeeListRoute(new NextRequest("http://localhost/api/employees?grade=invalid", { headers: authHeaders(hrIdentity) }))).status).toBe(422);
    const self = await testIdentity("employee", "E0001");
    const context = { params: Promise.resolve({ employeeId: "E0001", eventId: "EV_036" }) };
    const malformed = await completionRoute(new Request("http://localhost", { method: "POST", body: "{", headers: authHeaders(self) }), context);
    expect(malformed.status).toBe(400);
    const invalidDate = await completionRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify({ completedAt: "2026-02-30" }), headers: authHeaders(self) }), context);
    expect(invalidDate.status).toBe(422);
  });

  it("handles multipart import and rejects malformed multipart or blank required CSV numbers", async () => {
    expect((await importRoute(new Request("http://localhost/api/import", { method: "POST", body: "bad", headers: authHeaders(hrIdentity) }))).status).toBe(400);
    const form = new FormData();
    form.set("employees", new Blob([JSON.stringify(new EmployeeRepository().getById("E0001"))], { type: "application/json" }), "employees.json");
    const response = await importRoute(new Request("http://localhost/api/import", { method: "POST", body: form, headers: authHeaders(hrIdentity) }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.employeesUpdated).toBe(1);
    const csv = "record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nBAD,E0001,EV_036,2026-09-20,,completed,,,,self";
    expect(() => importData({ historyCsv: csv })).toThrow(AppError);
  });

  it("allows repeat completion, mandatory completion, and rejects unknown references", async () => {
    const db = getDatabase();
    const before = databaseCounts(db).activityHistory;
    await completeActivity("E0001", "EV_036", {}, db);
    await completeActivity("E0001", "EV_036", {}, db);
    expect(databaseCounts(db).activityHistory).toBe(before + 2);
    const employee = { ...new EmployeeRepository(db).getById("E0001")!, employee_id: "NEW_MANDATORY", skills: {}, career_goal: null };
    importData({ employeesJson: JSON.stringify(employee) }, db);
    const completed = await completeActivity(employee.employee_id, "EV_001", {}, db);
    expect(completed.activity.date).toBe("2026-10-01");
    expect(completed.view.recommendations.every((item) => !new EventRepository(db).getById(item.eventId)!.mandatory)).toBe(true);
    await expect(completeActivity(employee.employee_id, "MISSING", {}, db)).rejects.toMatchObject({ status: 404 });
    expect(() => importData({ historyCsv: "record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nUNKNOWN,MISSING,EV_036,2026-09-20,,completed,100,,,self" }, db)).toThrow(AppError);
  });

  it("imports a valid employee and history in one request", () => {
    const db = getDatabase();
    const employee = {
      employee_id: "E9999",
      full_name: "Demo Employee",
      department: "Backend Development",
      role: "Backend Engineer",
      grade: "Junior",
      manager_id: null,
      hire_date: "2026-01-01",
      tenure_months: 9,
      work_format: "hybrid",
      preferred_language: "ru",
      career_goal: { target_role: "Backend Engineer", target_grade: "Middle" },
      skills: { SK_PYTHON: 2 },
      last_review_date: "2026-09-01",
    };
    const history = [
      "record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by",
      "LOCAL_IMPORT_1,E9999,EV_036,2026-09-20,,completed,100,,5,self",
    ].join("\n");
    const result = importData({ employeesJson: JSON.stringify(employee), historyCsv: history }, db);
    expect(result).toEqual({
      employeesInserted: 1,
      employeesUpdated: 0,
      historyInserted: 1,
      historySkipped: 0,
    });
    expect(new EmployeeRepository(db).getById("E9999")?.full_name).toBe("Demo Employee");
  });

  it("does not partially import data when history references an unknown event", () => {
    const db = getDatabase();
    const employee = {
      employee_id: "E9998",
      full_name: "Rollback Employee",
      department: "Backend Development",
      role: "Backend Engineer",
      grade: "Junior",
      manager_id: null,
      hire_date: "2026-01-01",
      tenure_months: 9,
      work_format: "office",
      preferred_language: "en",
      career_goal: null,
      skills: {},
      last_review_date: "2026-09-01",
    };
    const history = [
      "record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by",
      "LOCAL_BAD_1,E9998,EV_UNKNOWN,2026-09-20,,completed,100,,,self",
    ].join("\n");
    expect(() => importData({ employeesJson: JSON.stringify(employee), historyCsv: history }, db)).toThrow(
      AppError,
    );
    expect(new EmployeeRepository(db).getById("E9998")).toBeNull();
  });
});

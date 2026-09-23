import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as employeeListRoute } from "@/app/api/employees/route";
import { GET as employeeRoute } from "@/app/api/employees/[employeeId]/route";
import { GET as recommendationsRoute } from "@/app/api/employees/[employeeId]/recommendations/route";
import { POST as completionRoute } from "@/app/api/employees/[employeeId]/activities/[eventId]/complete/route";
import { GET as hrRoute } from "@/app/api/hr/summary/route";
import { POST as importRoute } from "@/app/api/import/route";
import { createCareerApi } from "@/lib/frontend/api";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { EmployeeRepository } from "@/server/repositories";
import type { EmployeeDetail, HrSummaryResult } from "@/contracts/api";
import { authHeaders, testIdentity, type TestIdentity } from "./helpers/auth";

const employeeId = "JURY_DEMO_001";
const profileJson = fs.readFileSync("docs/fixtures/jury-employee.json", "utf8");
const historyCsv = fs.readFileSync("docs/fixtures/jury-history.csv", "utf8");
let temporaryDirectory: string;
let hrIdentity: TestIdentity;
let employeeIdentity: TestIdentity | undefined;

beforeEach(async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  closeDatabase();
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "career-quest-jury-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(temporaryDirectory, "jury.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  hrIdentity = await testIdentity();
  employeeIdentity = undefined;
});

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const fetcher: typeof fetch = async (url, init) => {
  if (String(url).includes("/activities/") && !employeeIdentity) employeeIdentity = await testIdentity("employee", employeeId);
  const identity = String(url).includes("/activities/") ? employeeIdentity! : hrIdentity;
  const request = new NextRequest("http://localhost" + String(url), { ...init, signal: init?.signal ?? undefined, headers: authHeaders(identity, init?.headers) });
  const parts = request.nextUrl.pathname.split("/");
  if (parts[2] === "import") return importRoute(request);
  if (parts[2] === "hr") return hrRoute(request);
  if (!parts[3]) return employeeListRoute(request);
  const id = decodeURIComponent(parts[3]);
  if (parts[4] === "activities") return completionRoute(request, { params: Promise.resolve({ employeeId: id, eventId: parts[5] }) });
  if (parts[4] === "recommendations") return recommendationsRoute(request, { params: Promise.resolve({ employeeId: id }) });
  return employeeRoute(request, { params: Promise.resolve({ employeeId: id }) });
};

async function upload(field: "employees" | "history", source: string, filename: string) {
  const form = new FormData();
  form.set(field, new File([source], filename));
  return importRoute(new Request("http://localhost/api/import", { method: "POST", body: form, headers: authHeaders(hrIdentity) }));
}

async function detail(): Promise<EmployeeDetail> {
  const response = await employeeRoute(new Request("http://localhost", { headers: authHeaders(hrIdentity) }), { params: Promise.resolve({ employeeId }) });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

describe("jury workflow: profile JSON, then history CSV", () => {
  it("imports separately through the frontend transport, recalculates, completes and persists", async () => {
    const api = createCareerApi({ fetcher });
    const profileResult = await api.importData(new File([profileJson], "jury-employee.json"));
    expect(profileResult.employeeIds).toEqual([employeeId]);
    expect(profileResult.message).toContain("1 new profiles");
    expect(await api.getEmployees()).toHaveLength(201);
    const baseline = await detail();
    expect(baseline.readiness).toBe(71.3);
    expect(baseline.effectiveSkills.SK_SYSTEM_DESIGN).toBe(1);
    expect(baseline.completedActivities).toEqual([]);
    const assessed = baseline.employee.skills;

    const historyResult = await api.importData(new File([historyCsv], "jury-history.csv"));
    expect(historyResult.employeeIds).toEqual([employeeId]);
    expect(historyResult.message).toContain("2 history records");
    const imported = await detail();
    expect(imported.readiness).toBe(74.1);
    expect(imported.effectiveSkills).toMatchObject({ SK_SYSTEM_DESIGN: 2, SK_API_DESIGN: 4 });
    expect(imported.employee.skills).toEqual(assessed);
    expect(imported.completedActivities).toEqual([expect.objectContaining({
      event_id: "EV_005", eventTitle: "System Design Fundamentals", score: 90, feedback_rating: 5, due_date: null,
    })]);
    expect(imported.activeMandatoryObligations).toEqual([expect.objectContaining({
      event_id: "EV_001", status: "overdue", due_date: "2026-09-15", score: null, feedback_rating: null,
    })]);
    expect(imported.recommendations.every((item) => !["EV_001", "EV_005"].includes(item.eventId))).toBe(true);
    const recommendations = await recommendationsRoute(new Request("http://localhost", { headers: authHeaders(hrIdentity) }), { params: Promise.resolve({ employeeId }) });
    expect(recommendations.status).toBe(200);
    expect((await recommendations.json()).data).toEqual(imported);

    const repeated = await api.importData(new File([historyCsv], "jury-history.csv"));
    expect(repeated.warnings).toEqual(["Skipped 2 existing history records."]);
    expect(databaseCounts(getDatabase()).activityHistory).toBe(2745);
    await expect(api.completeActivity(employeeId, "EV_005")).rejects.toMatchObject({ phase: "rejected" });

    const nextStep = imported.recommendations[0];
    expect(nextStep).toBeDefined();
    const completed = await api.completeActivity(employeeId, nextStep.eventId);
    expect(completed.readiness).toBeGreaterThan(imported.readiness);
    expect(completed.employee.skills).toEqual(assessed);
    for (const change of nextStep.expectedChanges) {
      expect(completed.effectiveSkills[change.skillId]).toBe(change.after);
    }
    const summaryResponse = await hrRoute(new NextRequest("http://localhost/api/hr/summary?department=Jury%20Demo", { headers: authHeaders(hrIdentity) }));
    const summary: HrSummaryResult = (await summaryResponse.json()).data;
    expect(summary).toMatchObject({ population: 1, totalActivities: 3, completionRate: 66.7 });
    expect(summary.participationByStatus).toMatchObject({ completed: 2, overdue: 1 });
    expect(summary.assignedBy).toEqual({ self: 2, hr: 1, manager: 0 });
    expect((await api.getHrSummary()).metrics?.totalEmployees).toBe(201);
    expect(databaseCounts(getDatabase())).toMatchObject({ employees: 201, activityHistory: 2746 });
    closeDatabase();
    const reopened = await detail();
    expect(reopened.readiness).toBe(completed.readiness);
    expect(reopened.effectiveSkills).toEqual(completed.effectiveSkills);
    expect(reopened.completedActivities).toHaveLength(2);
    expect(reopened.activeMandatoryObligations).toHaveLength(1);
  });

  it("reports the missing employee when CSV is uploaded before JSON, without importing rows", async () => {
    const response = await upload("history", historyCsv, "jury-history.csv");
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [expect.objectContaining({ file: "jury-history.csv", row: 2, field: "employee_id" })],
    });
    expect(databaseCounts(getDatabase())).toMatchObject({ employees: 200, activityHistory: 2743 });
  });

  it("rejects an invalid CSV row atomically while retaining the previously imported JSON", async () => {
    expect((await upload("employees", profileJson, "jury-employee.json")).status).toBe(201);
    const invalidCsv = historyCsv.replace("EV_001", "EV_UNKNOWN");
    const response = await upload("history", invalidCsv, "jury-history.csv");
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toContainEqual(expect.objectContaining({
      file: "jury-history.csv", row: 3, field: "event_id",
    }));
    expect(databaseCounts(getDatabase())).toMatchObject({ employees: 201, activityHistory: 2743 });
    expect((await detail()).readiness).toBe(71.3);
    expect((await detail()).completedActivities).toEqual([]);
    expect((await upload("history", historyCsv, "jury-history.csv")).status).toBe(201);
    expect((await detail()).readiness).toBe(74.1);
  });

  it("reports invalid profile fields and leaves the database unchanged", async () => {
    const profile = JSON.parse(profileJson);
    profile.employees[0].skills.SK_SYSTEM_DESIGN = 9;
    const response = await upload("employees", JSON.stringify(profile), "jury-employee.json");
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toContainEqual(expect.objectContaining({
      file: "jury-employee.json", row: 1, field: "skills.SK_SYSTEM_DESIGN",
    }));
    expect(new EmployeeRepository().getById(employeeId)).toBeNull();
    expect(databaseCounts(getDatabase())).toMatchObject({ employees: 200, activityHistory: 2743 });
  });
});

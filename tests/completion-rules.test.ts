import { describe, expect, it } from "vitest";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getCompletionEligibility, getEmployeeView, SNAPSHOT_DATE } from "../src/lib/recommendation";
import type { ActivityRecord, CareerDataset, DevelopmentEvent, Employee } from "../src/types/career";

const employee: Employee = {
  employee_id: "COMPLETION_EMPLOYEE", full_name: "Completion Employee", department: "Engineering",
  role: "Backend Engineer", grade: "Middle", manager_id: null, hire_date: "2024-01-01", tenure_months: 33,
  work_format: "hybrid", preferred_language: "en", career_goal: null,
  skills: { SYSTEM: 1 }, last_review_date: "2026-09-01",
};

function event(event_id = "ACTIVITY", overrides: Partial<DevelopmentEvent> = {}): DevelopmentEvent {
  return {
    event_id, title: event_id, description: "Completion rules fixture", type: "course", format: "self_paced",
    duration_hours: 2, mandatory: false, target_roles: [employee.role], target_grades: ["Middle", "Senior"],
    develops_skills: [{ skill_id: "SYSTEM", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [],
    ...overrides,
  };
}

function record(event_id: string, status: ActivityRecord["status"], date = "2026-08-01"): ActivityRecord {
  return {
    record_id: `RECORD_${event_id}_${status}_${date}`, employee_id: employee.employee_id, event_id, status, date,
    due_date: null, completion_pct: status === "completed" ? 100 : 25, score: null, feedback_rating: null, assigned_by: "self",
  };
}

function dataset(events: DevelopmentEvent[], history: ActivityRecord[] = [], overrides: Partial<Employee> = {}) {
  const raw: CareerDataset = {
    employees: [{ ...employee, ...overrides }], events, history,
    skills: [
      { skill_id: "SYSTEM", name: "System Design", type: "hard", category: "Engineering", description: "" },
      { skill_id: "MISSING", name: "Missing skill", type: "hard", category: "Engineering", description: "" },
    ],
    roleProfiles: [
      { role: employee.role, grade: "Senior", required_skills: { SYSTEM: 4 }, critical_skills: ["SYSTEM"] },
      { role: "Data Analyst", grade: "Senior", required_skills: { SYSTEM: 4 }, critical_skills: [] },
    ],
  };
  return normalizeDataset(raw);
}

describe("completion domain eligibility", () => {
  it("defaults available self-paced completion to the fixed snapshot", () => {
    expect(getCompletionEligibility(dataset([event()]), employee.employee_id, "ACTIVITY")).toEqual({
      eligible: true, completionDate: SNAPSHOT_DATE, reasons: [],
    });
  });

  it("defaults scheduled completion to the earliest valid session at or after the snapshot", () => {
    const input = dataset([event("ACTIVITY", { format: "online", upcoming_sessions: ["2026-10-20", "2026-09-30", "2026-10-01", "2026-10-12"] })]);
    expect(getCompletionEligibility(input, employee.employee_id, "ACTIVITY").completionDate).toBe("2026-10-01");
    expect(getCompletionEligibility(input, employee.employee_id, "ACTIVITY", "2026-10-20")).toEqual({
      eligible: true, completionDate: "2026-10-20", reasons: [],
    });
  });

  it.each([undefined, "2026-10-20"])("never bypasses unavailable scheduled sessions with explicit date %s", (completedAt) => {
    const result = getCompletionEligibility(dataset([event("ACTIVITY", { format: "offline", upcoming_sessions: ["2026-09-30"] })]), employee.employee_id, "ACTIVITY", completedAt);
    expect(result).toMatchObject({ eligible: false, reasons: expect.arrayContaining([expect.objectContaining({ code: "unavailable" })]) });
    expect(result.completionDate).toBeUndefined();
  });

  it("rejects an unlisted future date even when another scheduled session is available", () => {
    const result = getCompletionEligibility(dataset([event("ACTIVITY", { format: "online", upcoming_sessions: ["2026-10-20"] })]), employee.employee_id, "ACTIVITY", "2026-10-21");
    expect(result).toEqual({ eligible: false, reasons: [{ code: "invalid_completion_date", message: expect.any(String) }] });
  });

  it.each(["2026-09-30", "2026-02-30", "2027-02-29", "2026-13-01", "2026-10-1", "2026-10-01T00:00:00Z", "", "not-a-date"])("rejects invalid or historical self-paced date %s", (completedAt) => {
    const result = getCompletionEligibility(dataset([event()]), employee.employee_id, "ACTIVITY", completedAt);
    expect(result).toEqual({ eligible: false, reasons: [{ code: "invalid_completion_date", message: expect.any(String) }] });
  });

  it("accepts a real future leap day for self-paced completion", () => {
    expect(getCompletionEligibility(dataset([event()]), employee.employee_id, "ACTIVITY", "2028-02-29")).toEqual({ eligible: true, completionDate: "2028-02-29", reasons: [] });
  });

  it("rejects nonexistent calendar dates in scheduled sessions even for a direct normalized-dataset caller", () => {
    const result = getCompletionEligibility(dataset([event("ACTIVITY", { format: "online", upcoming_sessions: ["2026-11-31"] })]), employee.employee_id, "ACTIVITY");
    expect(result).toEqual({ eligible: false, reasons: [{ code: "unavailable", message: expect.any(String) }] });
  });

  it("allows current or resolved target role/grade pairs without mixing one role with another grade", () => {
    const input = dataset([
      event("CURRENT", { target_grades: ["Middle"] }),
      event("TARGET", { target_roles: ["Data Analyst"], target_grades: ["Senior"] }),
      event("MIXED", { target_roles: ["Data Analyst"], target_grades: ["Middle"] }),
    ], [], { career_goal: { target_role: "Data Analyst", target_grade: "Senior" } });
    expect(getCompletionEligibility(input, employee.employee_id, "CURRENT").eligible).toBe(true);
    expect(getCompletionEligibility(input, employee.employee_id, "TARGET").eligible).toBe(true);
    expect(getCompletionEligibility(input, employee.employee_id, "MIXED")).toMatchObject({ eligible: false, reasons: [{ code: "audience" }] });
  });

  it("does not let an explicit date bypass audience or prerequisites", () => {
    const result = getCompletionEligibility(dataset([event("ACTIVITY", { target_roles: ["Sales Manager"], prerequisites: { SYSTEM: 2, MISSING: 1 } })]), employee.employee_id, "ACTIVITY", SNAPSHOT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reasons.map(({ code }) => code)).toEqual(["audience", "prerequisites"]);
    expect(result.reasons[1].message).toContain("System Design: current 1, required 2");
    expect(result.reasons[1].message).toContain("Missing skill: current 0, required 1");
  });

  it("checks prerequisites against post-review effective skills rather than assessed skills", () => {
    const input = dataset([event("GAIN"), event("ACTIVITY", { prerequisites: { SYSTEM: 2 } })], [record("GAIN", "completed", "2026-09-20")]);
    expect(getCompletionEligibility(input, employee.employee_id, "ACTIVITY").eligible).toBe(true);
    expect(input.employees[0].skills.SYSTEM).toBe(1);
  });

  it("does not count in-progress or pre-review history as a new prerequisite skill gain", () => {
    for (const history of [[record("GAIN", "in_progress", "2026-09-20")], [record("GAIN", "completed", "2026-08-20")]]) {
      const result = getCompletionEligibility(dataset([event("GAIN"), event("ACTIVITY", { prerequisites: { SYSTEM: 2 } })], history), employee.employee_id, "ACTIVITY");
      expect(result).toMatchObject({ eligible: false, reasons: [{ code: "prerequisites" }] });
    }
  });

  it("allows mandatory and in-progress completion while keeping both out of new recommendations", () => {
    const input = dataset([event("MANDATORY", { mandatory: true }), event("IN_PROGRESS")], [record("IN_PROGRESS", "in_progress")]);
    expect(getCompletionEligibility(input, employee.employee_id, "MANDATORY").eligible).toBe(true);
    expect(getCompletionEligibility(input, employee.employee_id, "IN_PROGRESS").eligible).toBe(true);
    expect(getEmployeeView(input, employee.employee_id).recommendations).toEqual([]);
  });

  it("does not require target-gap reduction, a top-three recommendation or a target", () => {
    const input = dataset([event("NO_GAIN", { develops_skills: [] }), event("AT_CAP", { develops_skills: [{ skill_id: "SYSTEM", gain: 1, max_level: 1 }] })]);
    expect(getEmployeeView(input, employee.employee_id).recommendations).toEqual([]);
    expect(getCompletionEligibility(input, employee.employee_id, "NO_GAIN").eligible).toBe(true);
    expect(getCompletionEligibility(input, employee.employee_id, "AT_CAP").eligible).toBe(true);

    const lead = dataset([event("LEAD", { target_grades: ["Lead"] }), event("OTHER_GRADE", { target_grades: ["Middle"] })], [], { grade: "Lead" });
    expect(getEmployeeView(lead, employee.employee_id).target).toBeNull();
    expect(getCompletionEligibility(lead, employee.employee_id, "LEAD").eligible).toBe(true);
    expect(getCompletionEligibility(lead, employee.employee_id, "OTHER_GRADE")).toMatchObject({ eligible: false, reasons: [{ code: "audience" }] });
  });

  it("allows only EV_036 to repeat, including mandatory activities and dates after old completions", () => {
    const input = dataset([event("ACTIVITY"), event("MANDATORY", { mandatory: true }), event("EV_036")], [record("ACTIVITY", "completed"), record("MANDATORY", "completed"), record("EV_036", "completed")]);
    for (const eventId of ["ACTIVITY", "MANDATORY"]) {
      expect(getCompletionEligibility(input, employee.employee_id, eventId, "2026-10-20")).toMatchObject({ eligible: false, reasons: [{ code: "completed" }] });
    }
    expect(getCompletionEligibility(input, employee.employee_id, "EV_036").eligible).toBe(true);
  });

  it("returns clear missing-entity reasons for callers without HTTP guards", () => {
    const input = dataset([event()]);
    expect(getCompletionEligibility(input, "MISSING", "ACTIVITY")).toMatchObject({ eligible: false, reasons: [{ code: "employee_not_found" }] });
    expect(getCompletionEligibility(input, employee.employee_id, "MISSING")).toMatchObject({ eligible: false, reasons: [{ code: "event_not_found" }] });
  });

  it("does not mutate domain inputs or change the recommendation result", () => {
    const input = dataset([event("ACTIVITY", { format: "online", upcoming_sessions: ["2026-10-20", "2026-10-01"] })]);
    const serialized = JSON.stringify(input);
    const view = getEmployeeView(input, employee.employee_id);
    getCompletionEligibility(input, employee.employee_id, "ACTIVITY");
    getCompletionEligibility(input, employee.employee_id, "ACTIVITY", "2026-10-03");
    expect(JSON.stringify(input)).toBe(serialized);
    expect(getEmployeeView(input, employee.employee_id)).toEqual(view);
  });
});

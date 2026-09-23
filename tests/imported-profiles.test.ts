import { describe, expect, it } from "vitest";
import { buildHrSummary } from "../src/lib/analytics/hr-summary";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView, SNAPSHOT_DATE } from "../src/lib/recommendation";
import type { ActivityRecord, CareerDataset, DevelopmentEvent, Employee } from "../src/types/career";

const employee: Employee = {
  employee_id: "JURY_TRANSFER",
  full_name: "Imported Profile",
  department: "Engineering",
  role: "Backend Engineer",
  grade: "Middle",
  manager_id: null,
  hire_date: "2023-01-01",
  tenure_months: 45,
  work_format: "hybrid",
  preferred_language: "en",
  career_goal: { target_role: "Data Analyst", target_grade: "Senior" },
  skills: { PYTHON: 1, DESIGN: 5 },
  last_review_date: "2026-01-01",
};

function event(eventId: string, overrides: Partial<DevelopmentEvent> = {}): DevelopmentEvent {
  return {
    event_id: eventId,
    title: eventId,
    description: "",
    type: "course",
    format: "self_paced",
    duration_hours: 2,
    mandatory: false,
    target_roles: ["Data Analyst"],
    target_grades: ["Senior"],
    develops_skills: [{ skill_id: "SQL", gain: 1, max_level: 3 }],
    prerequisites: {},
    upcoming_sessions: [],
    ...overrides,
  };
}

function record(id: string, eventId: string, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    record_id: id,
    employee_id: employee.employee_id,
    event_id: eventId,
    date: SNAPSHOT_DATE,
    due_date: null,
    status: "completed",
    completion_pct: 100,
    score: null,
    feedback_rating: null,
    assigned_by: "self",
    ...overrides,
  };
}

function source(): CareerDataset {
  return {
    employees: [structuredClone(employee)],
    events: [
      event("JURY_SQL"),
      event("JURY_PYTHON", {
        develops_skills: [{ skill_id: "PYTHON", gain: 2, max_level: 3 }],
        prerequisites: { SQL: 1 },
      }),
    ],
    skills: ["PYTHON", "SQL", "DESIGN"].map((id) => ({
      skill_id: id, name: id, type: "hard", category: "Engineering", description: "",
    })),
    roleProfiles: [
      { role: "Data Analyst", grade: "Senior", required_skills: { PYTHON: 3, SQL: 1 }, critical_skills: ["PYTHON"] },
      { role: "Backend Engineer", grade: "Senior", required_skills: { DESIGN: 4 }, critical_skills: ["DESIGN"] },
    ],
    history: [],
  };
}

describe("additional employee profiles", () => {
  it("uses the imported career goal and requires a complete current or target audience pair", () => {
    const data = source();
    data.events.push(event("WRONG_PAIR", { target_roles: ["Backend Engineer"] }));
    const view = getEmployeeView(normalizeDataset(data), employee.employee_id);
    expect(view.target).toEqual({ role: "Data Analyst", grade: "Senior" });
    expect(view.skillGaps.map((gap) => gap.skillId).sort()).toEqual(["PYTHON", "SQL"]);
    expect(view.skillGaps.find((gap) => gap.skillId === "SQL")?.currentLevel).toBe(0);
    expect(view.recommendations.map((rec) => rec.eventId)).toEqual(["JURY_SQL"]);
    expect(view.readiness).toBe(22.2);
  });

  it("reconstructs unordered imported history without applying old, incomplete, or another employee's records", () => {
    const data = source();
    data.events.push(event("JURY_ADVANCED", {
      develops_skills: [{ skill_id: "SQL", gain: 3, max_level: 5 }],
    }));
    data.history = [
      record("late", "JURY_ADVANCED", { date: "2026-09-01" }),
      record("review", "JURY_ADVANCED", { date: employee.last_review_date }),
      record("early", "JURY_SQL", { date: "2026-03-01" }),
      record("old", "JURY_ADVANCED", { date: "2025-12-31" }),
      record("incomplete", "JURY_PYTHON", { status: "dropped", completion_pct: 50 }),
      record("other", "JURY_PYTHON", { employee_id: "JURY_OTHER" }),
    ];
    const original = structuredClone(data);
    const normalized = normalizeDataset(data);
    const view = getEmployeeView(normalized, employee.employee_id);
    expect(view.effectiveSkills).toEqual({ PYTHON: 1, DESIGN: 5, SQL: 4 });
    expect(view.recommendations.map((rec) => rec.eventId)).toEqual(["JURY_PYTHON"]);
    expect(data).toEqual(original);
  });

  it("updates employee progress, HR gaps, and participation together after an imported profile completes a step", () => {
    const data = source();
    data.employees.push(
      { ...employee, employee_id: "JURY_LEAD", grade: "Lead", career_goal: null },
      { ...employee, employee_id: "JURY_BLOCKED", career_goal: null, skills: {} },
    );
    const normalized = normalizeDataset(data);
    const before = getEmployeeView(normalized, employee.employee_id);
    const beforeHr = buildHrSummary(normalized);
    expect(beforeHr.weakCompetencies.map((gap) => gap.skillId).sort()).toEqual(["DESIGN", "PYTHON", "SQL"]);
    expect(beforeHr.employeesWithoutRecommendations.map(({ employeeId, reason }) => ({ employeeId, reason }))).toEqual([
      { employeeId: "JURY_LEAD", reason: "needs_career_goal" },
      { employeeId: "JURY_BLOCKED", reason: "no_eligible_step" },
    ]);

    const completed = normalizeDataset({ ...data, history: [record("completion", "JURY_SQL")] });
    const after = getEmployeeView(completed, employee.employee_id);
    const afterHr = buildHrSummary(completed);
    expect(after.readiness).toBe(55.6);
    expect(after.readiness).toBeGreaterThan(before.readiness);
    expect(after.effectiveSkills.SQL).toBe(before.recommendations[0]?.expectedChanges[0]?.after);
    expect(after.recommendations.map((rec) => rec.eventId)).toEqual(["JURY_PYTHON"]);
    expect(afterHr.weakCompetencies).toEqual([
      { skillId: "DESIGN", name: "DESIGN", employeesBelowRequirement: 1 },
      { skillId: "PYTHON", name: "PYTHON", employeesBelowRequirement: 1 },
    ]);
    expect(afterHr.employeesWithoutRecommendations).toEqual(beforeHr.employeesWithoutRecommendations);
    expect(afterHr.participationByEvent).toEqual([
      { eventId: "JURY_SQL", title: "JURY_SQL", total: 1, byStatus: { completed: 1 } },
    ]);

    const finished = normalizeDataset({
      ...data, history: [...completed.history, record("final", "JURY_PYTHON")],
    });
    expect(getEmployeeView(finished, employee.employee_id).readiness).toBe(100);
    expect(buildHrSummary(finished).weakCompetencies).toEqual([
      { skillId: "DESIGN", name: "DESIGN", employeesBelowRequirement: 1 },
    ]);
    expect(buildHrSummary(finished).employeesWithoutRecommendations).toContainEqual({
      employeeId: employee.employee_id, fullName: employee.full_name, reason: "no_eligible_step",
    });
  });

  it("retains every participation status when aggregating added history", () => {
    const data = source();
    const statuses: ActivityRecord["status"][] = ["completed", "in_progress", "dropped", "no_show", "declined", "overdue"];
    data.history = statuses.map((status) => record(status, "JURY_SQL", { status }));
    data.history.push(record("second-completion", "JURY_SQL"));
    expect(buildHrSummary(normalizeDataset(data)).participationByEvent).toEqual([{
      eventId: "JURY_SQL", title: "JURY_SQL", total: 7,
      byStatus: { completed: 2, in_progress: 1, dropped: 1, no_show: 1, declined: 1, overdue: 1 },
    }]);
  });
});

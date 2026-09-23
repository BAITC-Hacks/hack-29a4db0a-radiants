import { describe, expect, it } from "vitest";
import { adaptStarterDataset, parseActivityHistoryRows } from "../src/lib/data/starter-dataset";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import type { DevelopmentEvent, Employee, RoleProfile, Skill } from "../src/types/career";

function fixture() {
  const employee: Employee = {
    employee_id: "NEW_EMPLOYEE", full_name: "Imported Employee", department: "Engineering",
    role: "Backend Engineer", grade: "Middle", manager_id: null, hire_date: "2023-01-01",
    tenure_months: 45, work_format: "hybrid", preferred_language: "ru", career_goal: null,
    skills: {}, last_review_date: "2026-01-01",
  };
  const event: DevelopmentEvent = {
    event_id: "NEW_EVENT", title: "Imported course", description: "", type: "course",
    format: "self_paced", duration_hours: 1.5, mandatory: false,
    target_roles: ["Backend Engineer"], target_grades: ["Middle", "Senior"],
    develops_skills: [{ skill_id: "NEW_SKILL", gain: 1, max_level: 3 }],
    prerequisites: {}, upcoming_sessions: [],
  };
  const skill: Skill = { skill_id: "NEW_SKILL", name: "Imported skill", type: "hard", category: "Engineering", description: "" };
  const profile: RoleProfile = { role: "Backend Engineer", grade: "Senior", required_skills: { NEW_SKILL: 3 }, critical_skills: ["NEW_SKILL"] };
  const row: Record<string, unknown> = {
    record_id: "NEW_RECORD", employee_id: "NEW_EMPLOYEE", event_id: "NEW_EVENT",
    date: "2026-09-01", due_date: "", status: "completed", completion_pct: "100",
    score: "0", feedback_rating: " ", assigned_by: "self",
  };
  return {
    employeesFile: { meta: { as_of_date: "2026-10-01" }, employees: [employee] },
    eventsFile: { events: [event] },
    skillsFile: { skills: [skill], role_profiles: [profile] },
    historyRows: [row],
  };
}

describe("starter dataset adapter", () => {
  it("maps official wrappers and numeric CSV cells into a detached, usable dataset", () => {
    const input = fixture();
    const original = structuredClone(input);
    const data = adaptStarterDataset(input);
    expect(data.roleProfiles).toEqual(input.skillsFile.role_profiles);
    expect(data.history[0]).toMatchObject({ completion_pct: 100, score: 0, feedback_rating: null, due_date: null });
    const view = getEmployeeView(normalizeDataset(data), "NEW_EMPLOYEE");
    expect(view.effectiveSkills.NEW_SKILL).toBe(1);
    expect(view.readiness).toBe(33.3);
    expect(view.recommendations).toEqual([]);
    data.employees[0]!.skills.NEW_SKILL = 5;
    data.events[0]!.develops_skills[0]!.gain = 4;
    expect(input).toEqual(original);
  });

  it("does not inject demo entries and supports an empty employee/history batch", () => {
    const input = fixture();
    input.employeesFile.employees = [];
    input.historyRows = [];
    const data = adaptStarterDataset(input);
    expect(data.employees).toEqual([]);
    expect(data.history).toEqual([]);
    expect(data.events.map((event) => event.event_id)).toEqual(["NEW_EVENT"]);
    expect(data.skills.map((skill) => skill.skill_id)).toEqual(["NEW_SKILL"]);
  });

  it("accepts already typed history values and normalizes nullable cells", () => {
    const input = fixture();
    Object.assign(input.historyRows[0]!, { completion_pct: 100, score: null, feedback_rating: 5, due_date: "2026-09-03" });
    expect(parseActivityHistoryRows(input.historyRows)[0]).toMatchObject({
      completion_pct: 100, score: null, feedback_rating: 5, due_date: "2026-09-03",
    });
  });

  it.each([
    ["completion_pct", ""], ["completion_pct", "NaN"], ["completion_pct", "0x64"],
    ["completion_pct", "101"], ["completion_pct", false], ["score", "3.5"],
    ["score", Infinity], ["feedback_rating", "0"], ["feedback_rating", "6"],
    ["date", "2026-02-30"], ["date", undefined], ["due_date", "2026-13-01"],
    ["status", "done"], ["assigned_by", "unknown"],
  ])("rejects invalid history %s=%s with a row and field location", (field, value) => {
    const input = fixture();
    input.historyRows[0]![field as string] = value;
    expect(() => parseActivityHistoryRows(input.historyRows)).toThrow(`historyRows[0].${field}`);
  });

  it("rejects missing wrappers and distinguishes source schemas from CareerDataset", () => {
    const input = fixture();
    expect(() => adaptStarterDataset({ ...input, employeesFile: [] })).toThrow("employees.json");
    expect(() => adaptStarterDataset({ ...input, skillsFile: { skills: [], roleProfiles: [] } })).toThrow("skills.json.role_profiles");
  });

  it("rejects duplicate IDs instead of silently overwriting indexed records", () => {
    const input = fixture();
    input.employeesFile.employees.push(structuredClone(input.employeesFile.employees[0]!));
    expect(() => adaptStarterDataset(input)).toThrow("employees.json.employees[1]: duplicate ID");
    const rows = fixture().historyRows;
    expect(() => parseActivityHistoryRows([...rows, ...rows])).toThrow("historyRows[1]: duplicate ID");
  });

  it.each(["employee_id", "event_id"])("rejects unknown history %s references in a complete dataset", (field) => {
    const input = fixture();
    input.historyRows[0]![field] = "UNKNOWN";
    expect(() => adaptStarterDataset(input)).toThrow(`historyRows[0].${field}: unknown`);
  });

  it("rejects out-of-range skills, missing target profiles, and undefined catalog references", () => {
    const input = fixture();
    const employee = input.employeesFile.employees[0]!;
    Object.assign(employee.skills, { NEW_SKILL: 6 });
    expect(() => adaptStarterDataset(input)).toThrow("employees.json.employees[0].skills.NEW_SKILL");
    employee.skills = { UNKNOWN: 1 };
    expect(() => adaptStarterDataset(input)).toThrow("unknown skill ID UNKNOWN");
    employee.skills = {};
    employee.career_goal = { target_role: "Data Analyst", target_grade: "Senior" };
    expect(() => adaptStarterDataset(input)).toThrow("missing target role profile Data Analyst Senior");
    employee.career_goal = null;
    input.eventsFile.events[0]!.prerequisites = { UNKNOWN: 1 };
    expect(() => adaptStarterDataset(input)).toThrow("events.json.events[0].prerequisites: unknown skill ID");
  });

  it("accepts a Lead without a career goal and does not require an external manager profile", () => {
    const input = fixture();
    Object.assign(input.employeesFile.employees[0]!, { grade: "Lead", manager_id: "EXTERNAL_MANAGER" });
    const view = getEmployeeView(normalizeDataset(adaptStarterDataset(input)), "NEW_EMPLOYEE");
    expect(view.targetStatus).toBe("needs_career_goal");
  });
});

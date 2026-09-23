import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { adaptStarterDataset } from "../src/lib/data/starter-dataset";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView, SNAPSHOT_DATE } from "../src/lib/recommendation";
import type { ActivityRecord, CareerDataset, EmployeeView } from "../src/types/career";

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const readCsv = (file: string): Record<string, string>[] =>
  parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true });
const official = adaptStarterDataset({
  employeesFile: readJson("data/employees.json"), eventsFile: readJson("data/events.json"),
  skillsFile: readJson("data/skills.json"), historyRows: readCsv("data/activity_history.csv"),
});
const jury = adaptStarterDataset({
  employeesFile: readJson("docs/jury/employees.json"), eventsFile: readJson("data/events.json"),
  skillsFile: readJson("data/skills.json"), historyRows: readCsv("docs/jury/activity_history.csv"),
});

function assertEligible(view: EmployeeView, source: CareerDataset) {
  expect(view.recommendations.length).toBeLessThanOrEqual(3);
  expect(new Set(view.recommendations.map((rec) => rec.eventId)).size).toBe(view.recommendations.length);
  for (const rec of view.recommendations) {
    const event = source.events.find((item) => item.event_id === rec.eventId)!;
    expect(event.mandatory).toBe(false);
    expect([view.employee, view.target].some((pair) => pair &&
      event.target_roles.includes(pair.role) && event.target_grades.includes(pair.grade))).toBe(true);
    for (const [id, required] of Object.entries(event.prerequisites)) {
      expect(view.effectiveSkills[id] ?? 0).toBeGreaterThanOrEqual(required!);
    }
    const history = source.history.filter((record) => record.employee_id === view.employee.employee_id && record.event_id === event.event_id);
    expect(history.some((record) => record.status === "in_progress")).toBe(false);
    if (event.event_id !== "EV_036") expect(history.some((record) => record.status === "completed")).toBe(false);
    if (event.format !== "self_paced") {
      expect(rec.nextSession).toBe(event.upcoming_sessions.filter((date) => date >= SNAPSHOT_DATE).sort()[0]);
      expect(rec.nextSession).toBeDefined();
    }
    expect(rec.expectedChanges.some((change) => Math.min(change.after, change.required) > Math.min(change.before, change.required))).toBe(true);
  }
}

describe("official dataset and jury acceptance", () => {
  it("revalidates every profile and each first completion against independent invariants", () => {
    expect([official.employees.length, official.events.length, official.skills.length, official.roleProfiles.length, official.history.length])
      .toEqual([200, 40, 60, 32, 2743]);
    const dataset = normalizeDataset(official);
    let completions = 0;
    let recommendationsChecked = 0;
    for (const employee of official.employees) {
      const before = getEmployeeView(dataset, employee.employee_id);
      assertEligible(before, official);
      recommendationsChecked += before.recommendations.length;
      const first = before.recommendations[0];
      if (!first) continue;
      const record: ActivityRecord = {
        record_id: "QUALITY_" + employee.employee_id, employee_id: employee.employee_id,
        event_id: first.eventId, date: first.nextSession ?? SNAPSHOT_DATE, due_date: null,
        status: "completed", completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self",
      };
      const changed = { ...official, history: [...official.history, record] };
      const after = getEmployeeView(normalizeDataset(changed), employee.employee_id);
      if (employee.employee_id === "E0058") {
        expect(first.eventId).toBe("EV_012");
        expect([before.readiness, after.readiness]).toEqual([53.9, 57.8]);
      }
      assertEligible(after, changed);
      recommendationsChecked += after.recommendations.length;
      expect(after.readiness, employee.employee_id).toBeGreaterThan(before.readiness);
      for (const [skill, level] of Object.entries(before.effectiveSkills)) {
        expect(after.effectiveSkills[skill] ?? 0, employee.employee_id + ":" + skill).toBeGreaterThanOrEqual(level);
      }
      for (const change of first.expectedChanges) expect(after.effectiveSkills[change.skillId] ?? 0).toBe(change.after);
      completions++;
    }
    expect(completions).toBe(173);
    console.info(JSON.stringify({ profiles: 200, positiveCompletions: completions, recommendationsChecked }));
  });

  it("selects a critical engineering gap over the lowest speaking skill in an imported profile", () => {
    const view = getEmployeeView(normalizeDataset(jury), "JURY_CRITICAL");
    expect(view.target).toEqual({ role: "Backend Engineer", grade: "Senior" });
    expect(view.skillGaps.find((gap) => gap.skillId === "SK_PUBLIC_SPEAKING")?.currentLevel).toBe(0);
    expect(view.recommendations[0]?.eventId).not.toBe("EV_036");
    expect(view.recommendations[0]?.expectedChanges.some((change) => change.critical && change.after > change.before)).toBe(true);
    assertEligible(view, jury);
  });

  it("handles missing skills, pre/post-review history, caps and completed exclusion on import", () => {
    const view = getEmployeeView(normalizeDataset(jury), "JURY_HISTORY");
    expect(view.skillGaps.find((gap) => gap.skillId === "SK_PYTHON")?.currentLevel).toBe(0);
    expect(view.effectiveSkills.SK_MENTORING).toBe(1);
    expect(view.effectiveSkills.SK_SYSTEM_DESIGN).toBe(2);
    expect(view.effectiveSkills.SK_API_DESIGN).toBe(4);
    expect(view.effectiveSkills.SK_CLOUD).toBe(3);
    expect(view.recommendations.some((rec) => rec.eventId === "EV_005")).toBe(false);
    assertEligible(view, jury);
  });

  it("handles Lead without a goal and a subsequently imported cross-role career goal", () => {
    const view = getEmployeeView(normalizeDataset(jury), "JURY_LEAD");
    expect(view.targetStatus).toBe("needs_career_goal");
    expect(view.recommendations).toEqual([]);
    expect(view.effectiveSkills.SK_SYSTEM_DESIGN).toBe(4);
    const source: CareerDataset = { ...jury, employees: jury.employees.map((employee) =>
      employee.employee_id === "JURY_LEAD" ? { ...employee, career_goal: { target_role: "Data Analyst", target_grade: "Middle" } } : employee) };
    const changed = getEmployeeView(normalizeDataset(source), "JURY_LEAD");
    expect(changed.target).toEqual({ role: "Data Analyst", grade: "Middle" });
    expect(changed.recommendations.length).toBeGreaterThan(0);
    assertEligible(changed, source);
  });

  it("does not depend on fixture employee IDs or irrelevant skill changes", () => {
    const original = getEmployeeView(normalizeDataset(jury), "JURY_CRITICAL");
    const employee = { ...original.employee, employee_id: "NEVER_SEEN_BEFORE",
      skills: { ...original.employee.skills, SK_LABOR_LAW: 5 as const } };
    const source = { ...jury, employees: [employee],
      history: jury.history.filter((record) => record.employee_id === original.employee.employee_id)
        .map((record) => ({ ...record, employee_id: employee.employee_id })) };
    const renamed = getEmployeeView(normalizeDataset(source), employee.employee_id);
    expect(renamed.recommendations).toEqual(original.recommendations);
    expect(renamed.readiness).toBe(original.readiness);
  });
});

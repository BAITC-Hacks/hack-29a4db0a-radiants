import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { adaptStarterDataset } from "../src/lib/data/starter-dataset";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { checkActivityCompletion, previewActivityCompletion } from "../src/lib/recommendation/completion";
import type { ActivityRecord, CareerDataset } from "../src/types/career";

const json = (name: string): unknown => JSON.parse(fs.readFileSync(name, "utf8"));
const csv = (name: string): Record<string, string>[] => parse(fs.readFileSync(name, "utf8"), { columns: true, skip_empty_lines: true, bom: true });
const official = adaptStarterDataset({
  employeesFile: json("data/employees.json"), eventsFile: json("data/events.json"),
  skillsFile: json("data/skills.json"), historyRows: csv("data/activity_history.csv"),
});

function afterCompletion(source: CareerDataset, employeeId: string, eventId: string, date: string) {
  const completion: ActivityRecord = {
    record_id: "TEST_COMPLETION", employee_id: employeeId, event_id: eventId, date,
    due_date: null, status: "completed", completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self",
  };
  return normalizeDataset({ ...source, history: [...source.history, completion] });
}

describe("official completion policy and projection", () => {
  it("blocks EV_006 for E0178, then allows it after the valid EV_005 foundation", () => {
    const data = normalizeDataset(official);
    expect(checkActivityCompletion(data, "E0178", "EV_006")).toMatchObject({ allowed: false, reasons: [
      expect.objectContaining({ code: "prerequisites", missingSkills: [{ skillId: "SK_SYSTEM_DESIGN", current: 1, required: 2 }] }),
    ] });
    const first = previewActivityCompletion(data, "E0178", "EV_005");
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("Expected valid foundation activity");
    expect(first.preview.progress).toEqual({ before: 71.3, after: 74.1, delta: 2.8 });
    expect(first.preview.expectedChanges).toContainEqual(expect.objectContaining({ skillId: "SK_API_DESIGN", before: 4, after: 4 }));
    const after = afterCompletion(official, "E0178", "EV_005", first.completedAt);
    expect(checkActivityCompletion(after, "E0178", "EV_006")).toMatchObject({ allowed: true });
  });

  it("checks every recommendation for all 200 profiles and compares each independent preview to replay", () => {
    const data = normalizeDataset(official);
    const untouched = structuredClone(data);
    expect([data.employees.length, data.events.length, data.skills.length, data.roleProfiles.length, data.history.length])
      .toEqual([200, 40, 60, 32, 2743]);
    let profiles = 0;
    let previews = 0;
    for (const employee of data.employees) {
      const before = getEmployeeView(data, employee.employee_id);
      if (before.recommendations.length > 0) profiles++;
      for (const recommendation of before.recommendations) {
        const label = employee.employee_id + ":" + recommendation.eventId;
        const result = previewActivityCompletion(data, employee.employee_id, recommendation.eventId);
        expect(result.allowed, label).toBe(true);
        if (!result.allowed) throw new Error(label + " was unexpectedly denied");
        const after = getEmployeeView(afterCompletion(official, employee.employee_id, recommendation.eventId, result.completedAt), employee.employee_id);
        expect(result.preview.effectiveSkills, label).toEqual(after.effectiveSkills);
        expect(result.preview.skillGaps, label).toEqual(after.skillGaps);
        expect(result.preview.progress, label).toEqual({ before: before.readiness, after: after.readiness, delta: Math.round((after.readiness - before.readiness) * 10) / 10 });
        expect(after.readiness, label).toBeGreaterThan(before.readiness);
        for (const [skill, level] of Object.entries(before.effectiveSkills)) {
          expect(after.effectiveSkills[skill] ?? 0, label + ":" + skill).toBeGreaterThanOrEqual(level);
        }
        expect(result.preview.expectedChanges, label).toEqual(recommendation.expectedChanges);
        if (recommendation.eventId !== "EV_036") expect(after.recommendations.some((item) => item.eventId === recommendation.eventId)).toBe(false);
        previews++;
      }
    }
    expect(profiles).toBe(173);
    expect(previews).toBeGreaterThan(173);
    expect(data).toEqual(untouched);
    console.info(JSON.stringify({ officialProfiles: 200, profilesWithRecommendations: profiles, independentPreviewsVerified: previews }));
  });

  it("works for additional imported profiles and their own history without employee ID branches", () => {
    const jury = adaptStarterDataset({
      employeesFile: json("docs/jury/employees.json"), eventsFile: json("data/events.json"),
      skillsFile: json("data/skills.json"), historyRows: csv("docs/jury/activity_history.csv"),
    });
    const remapped: CareerDataset = {
      ...jury,
      employees: jury.employees.map((employee) => ({ ...employee, employee_id: "HIDDEN_" + employee.employee_id })),
      history: jury.history.map((record) => ({ ...record, employee_id: "HIDDEN_" + record.employee_id })),
    };
    const data = normalizeDataset(remapped);
    for (const employee of data.employees) {
      const view = getEmployeeView(data, employee.employee_id);
      for (const recommendation of view.recommendations) {
        const result = previewActivityCompletion(data, employee.employee_id, recommendation.eventId);
        expect(result.allowed).toBe(true);
        if (!result.allowed) throw new Error("Imported recommendation unexpectedly denied");
        const after = getEmployeeView(afterCompletion(remapped, employee.employee_id, recommendation.eventId, result.completedAt), employee.employee_id);
        expect(result.preview.effectiveSkills).toEqual(after.effectiveSkills);
        expect(result.preview.progress.after).toBe(after.readiness);
      }
    }
  });
});

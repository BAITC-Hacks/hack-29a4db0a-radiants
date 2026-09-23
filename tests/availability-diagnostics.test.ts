import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { loadDomainDataset } from "@/server/repositories";
import { completeActivity, getEmployeeProjection, getRecommendations } from "@/server/services/career-quest";
import { normalizeDataset } from "@/lib/data/normalize";
import { getEmployeeView, getRecommendationDiagnostics } from "@/lib/recommendation";
import type { ActivityRecord, CareerDataset, DevelopmentEvent, Employee } from "@/types/career";

let temporaryDirectory: string;

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_EXPLANATIONS_ENABLED", "true");
  closeDatabase();
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "career-quest-diagnostics-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(temporaryDirectory, "test.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve(process.cwd(), "data"));
});

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function controlledDataset(): CareerDataset {
  const employee: Employee = {
    employee_id: "DIAGNOSTIC_EMPLOYEE", full_name: "Test Employee", department: "Engineering",
    role: "Backend Engineer", grade: "Middle", manager_id: null, hire_date: "2024-01-01", tenure_months: 33,
    work_format: "hybrid", preferred_language: "en", career_goal: null,
    skills: { SYSTEM: 1 }, last_review_date: "2026-09-01",
  };
  const event = (event_id: string, overrides: Partial<DevelopmentEvent> = {}): DevelopmentEvent => ({
    event_id, title: event_id, description: "Skill development", type: "course", format: "self_paced", duration_hours: 2,
    mandatory: false, target_roles: [employee.role], target_grades: ["Middle", "Senior"],
    develops_skills: [{ skill_id: "SYSTEM", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [], ...overrides,
  });
  const record = (event_id: string, status: ActivityRecord["status"]): ActivityRecord => ({
    record_id: `H_${event_id}`, employee_id: employee.employee_id, event_id, status, date: "2026-08-01",
    due_date: null, completion_pct: status === "completed" ? 100 : 30, score: null, feedback_rating: null, assigned_by: "self",
  });
  return {
    employees: [employee],
    skills: [{ skill_id: "SYSTEM", name: "System Design", type: "hard", category: "Engineering", description: "" }],
    roleProfiles: [{ role: employee.role, grade: "Senior", required_skills: { SYSTEM: 4 }, critical_skills: ["SYSTEM"] }],
    events: [
      event("MANDATORY", { mandatory: true, prerequisites: { SYSTEM: 5 } }),
      event("AUDIENCE", { target_roles: ["Sales Manager"], prerequisites: { SYSTEM: 5 } }),
      event("PREREQUISITE", { prerequisites: { SYSTEM: 2 } }),
      event("UNAVAILABLE", { format: "online", upcoming_sessions: ["2026-09-30"] }),
      event("COMPLETED"),
      event("IN_PROGRESS"),
      event("AT_CAP", { develops_skills: [{ skill_id: "SYSTEM", gain: 1, max_level: 1 }] }),
      event("EV_036"),
    ],
    history: [record("COMPLETED", "completed"), record("IN_PROGRESS", "in_progress"), record("EV_036", "completed")],
  };
}

describe("recommendation availability diagnostics", () => {
  it("explains why E0043 has no next step after the remaining Public Speaking gap is closed", async () => {
    const before = getEmployeeProjection("E0043");
    expect(before.recommendationDiagnostics.status).toBe("available");
    expect(before.recommendations.map((item) => item.eventId)).toContain("EV_036");

    const { view } = await completeActivity("E0043", "EV_036", {});
    expect(view.readiness).toBe(65.2);
    expect(view.recommendations).toEqual([]);
    expect(view.recommendationDiagnostics.status).toBe("no_eligible_events");
    expect(view.recommendationDiagnostics.remainingGapCount).toBeGreaterThan(0);
    const blocked = view.recommendationDiagnostics.blockedEvents;
    expect(blocked.find((item) => item.title === "Leadership Foundations")?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "completed" }),
    ]));
    expect(blocked.find((item) => item.title === "Architecture Review Circle")?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "prerequisites", message: expect.stringContaining("System Design: сейчас 0, нужен уровень 2") }),
    ]));
    expect(blocked.every((item) => item.eventId !== "EV_036")).toBe(true);
  });

  it("uses mutually exclusive primary counts while keeping every concrete blocking reason", () => {
    const raw = controlledDataset();
    const before = JSON.stringify(raw);
    const dataset = normalizeDataset(raw);
    const view = getEmployeeView(dataset, "DIAGNOSTIC_EMPLOYEE");
    const diagnostics = getRecommendationDiagnostics(dataset, "DIAGNOSTIC_EMPLOYEE");
    expect(view.recommendations.map((item) => item.eventId)).toEqual(["EV_036"]);
    expect(diagnostics.status).toBe("available");
    expect(diagnostics.eligibleEventCount).toBe(1);
    expect(diagnostics.exclusionCounts).toEqual({ mandatory: 1, audience: 1, prerequisites: 1, unavailable: 1, completed: 1, in_progress: 1, no_gap_reduction: 1 });
    expect(diagnostics.blockedEvents.find((item) => item.eventId === "PREREQUISITE")?.reasons[0].message).toContain("System Design: сейчас 1, нужен уровень 2");
    expect(diagnostics.blockedEvents.map((item) => item.eventId)).not.toContain("MANDATORY");
    expect(diagnostics.summary).toContain("Подходящих добровольных занятий");
    expect(diagnostics.blockedEvents.flatMap((item) => item.reasons).every((reason) => /[А-Яа-яЁё]/u.test(reason.message))).toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
    expect(diagnostics.readinessExplanation).toMatchObject({ criticalWeight: 2, standardWeight: 1, precision: 1 });
    expect(diagnostics.readinessExplanation.formula).toContain("Мы сравниваем ваши навыки");
    expect(diagnostics.readinessExplanation.formula).toContain("вдвое сильнее");
    expect(diagnostics.readinessExplanation.formula).not.toMatch(/Readiness|sum\(|weight/);
  });

  it("diagnostic eligibility agrees with the real recommendation pool for all starter employees", () => {
    const dataset = normalizeDataset(loadDomainDataset(getDatabase()));
    for (const employee of dataset.employees) {
      const view = getEmployeeView(dataset, employee.employee_id);
      const diagnostics = getRecommendationDiagnostics(dataset, employee.employee_id);
      expect(view.recommendations.length).toBe(Math.min(3, diagnostics.eligibleEventCount));
      expect(Object.values(diagnostics.exclusionCounts).reduce((sum, count) => sum + count, 0) + diagnostics.eligibleEventCount).toBe(diagnostics.evaluatedEventCount);
      expect(diagnostics.catalogEventCount).toBe(40);
      expect(diagnostics.snapshotDate).toBe("2026-10-01");
      expect(diagnostics.blockedEvents.length).toBeLessThanOrEqual(10);
    }
  });

  it("separates no career goal from no eligible activity without inventing an evaluation", () => {
    const raw = controlledDataset();
    raw.employees[0].grade = "Lead";
    const dataset = normalizeDataset(raw);
    const diagnostics = getRecommendationDiagnostics(dataset, "DIAGNOSTIC_EMPLOYEE");
    expect(diagnostics.status).toBe("needs_career_goal");
    expect(diagnostics.evaluatedEventCount).toBe(0);
    expect(diagnostics.blockedEvents).toEqual([]);
    expect(getEmployeeView(dataset, "DIAGNOSTIC_EMPLOYEE").effectiveSkills).toEqual({ SYSTEM: 1 });
  });

  it("distinguishes a fully satisfied target from catalog limitations", () => {
    const raw = controlledDataset();
    raw.employees[0].skills.SYSTEM = 4;
    const dataset = normalizeDataset(raw);
    const diagnostics = getRecommendationDiagnostics(dataset, "DIAGNOSTIC_EMPLOYEE");
    expect(diagnostics.status).toBe("target_reached");
    expect(diagnostics.remainingGapCount).toBe(0);
    expect(diagnostics.eligibleEventCount).toBe(0);
    expect(diagnostics.summary).toContain("не решение о повышении");
    expect(getEmployeeView(dataset, "DIAGNOSTIC_EMPLOYEE").readiness).toBe(100);
  });

  it("returns complete personal history with original status, assignment and due dates", () => {
    const dataset = loadDomainDataset(getDatabase());
    const before = JSON.stringify(dataset);
    const statuses = new Set<string>();
    for (const employee of dataset.employees) {
      const detail = getEmployeeProjection(employee.employee_id);
      const expected = dataset.history.filter((record) => record.employee_id === employee.employee_id);
      expect(detail.activityHistory).toHaveLength(expected.length);
      for (const record of detail.activityHistory) {
        statuses.add(record.status);
        expect(record).toMatchObject(expected.find((item) => item.record_id === record.record_id)!);
        expect(record.eventTitle).toBe(dataset.events.find((event) => event.event_id === record.event_id)!.title);
      }
      expect(detail.completedActivities).toEqual(detail.activityHistory.filter((record) => record.status === "completed"));
    }
    expect([...statuses].sort()).toEqual(["completed", "declined", "dropped", "in_progress", "no_show", "overdue"]);
    expect(JSON.stringify(dataset)).toBe(before);
  // This full-catalog regression reloads SQLite for all 200 profiles. Allow slow
  // demo laptops/containers without relaxing any API or live-AI latency checks.
  }, 20_000);

  it("disables all model work when external AI is explicitly prohibited", async () => {
    vi.stubEnv("AI_EXPLANATIONS_ENABLED", "false");
    const explain = vi.fn(async () => []);
    const baseline = getEmployeeProjection("E0178");
    expect(baseline.recommendations.length).toBeGreaterThan(0);
    const result = await getRecommendations("E0178", getDatabase(), { explain });
    expect(explain).not.toHaveBeenCalled();
    expect(result).toEqual(baseline);
  });

  it("preserves history and diagnostics when AI is enabled", async () => {
    const baseline = getEmployeeProjection("E0178");
    const explain = vi.fn(async () => []);
    const result = await getRecommendations("E0178", getDatabase(), { explain });
    expect(explain).toHaveBeenCalledTimes(1);
    expect(result.activityHistory).toEqual(baseline.activityHistory);
    expect(result.recommendationDiagnostics).toEqual(baseline.recommendationDiagnostics);
  });
});

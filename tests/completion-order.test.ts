import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeDataset } from "@/lib/data/normalize";
import { getEmployeeView, SNAPSHOT_DATE } from "@/lib/recommendation";
import { previewActivityCompletion } from "@/lib/recommendation/completion";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { ActivityRepository, EmployeeRepository, loadDomainDataset } from "@/server/repositories";
import { completeActivity } from "@/server/services/career-quest";
import type { ActivityRecord, CareerDataset, DevelopmentEvent } from "@/types/career";

const employeeId = "COMPLETION_ORDER_EMPLOYEE";
const skillId = "SK_SYSTEM_DESIGN";

function event(event_id: string, gain: number, max_level: 2 | 5): DevelopmentEvent {
  return {
    event_id, title: event_id, description: "Completion ordering fixture", type: "course", format: "self_paced",
    duration_hours: 1, mandatory: false, target_roles: ["Backend Engineer"], target_grades: ["Middle", "Senior"],
    develops_skills: [{ skill_id: skillId, gain, max_level }], prerequisites: {}, upcoming_sessions: [],
  };
}

function record(event_id: string, record_id = "R_Z", date = SNAPSHOT_DATE): ActivityRecord {
  return { record_id, employee_id: employeeId, event_id, date, due_date: null, status: "completed", completion_pct: 100,
    score: null, feedback_rating: null, assigned_by: "self" };
}

function fixture(): CareerDataset {
  return {
    employees: [{ employee_id: employeeId, full_name: "Completion Order", department: "Engineering", role: "Backend Engineer",
      grade: "Middle", manager_id: null, hire_date: "2024-01-01", tenure_months: 33, work_format: "hybrid", preferred_language: "en",
      career_goal: null, skills: { [skillId]: 1 }, last_review_date: "2026-09-01" }],
    skills: [{ skill_id: skillId, name: "System Design", type: "hard", category: "Engineering", description: "" }],
    roleProfiles: [{ role: "Backend Engineer", grade: "Senior", required_skills: { [skillId]: 4 }, critical_skills: [skillId] }],
    events: [event("ORDER_A", 1, 2), event("ORDER_Z", 2, 5)],
    history: [record("ORDER_Z")],
  };
}

function insertFixture(db: Database.Database, source: CareerDataset) {
  new EmployeeRepository(db).upsert(source.employees[0]);
  const insertEvent = db.prepare(`INSERT INTO events(event_id,title,description,type,format,duration_hours,mandatory,
    target_roles_json,target_grades_json,develops_skills_json,prerequisites_json,upcoming_sessions_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const item of source.events) insertEvent.run(item.event_id, item.title, item.description, item.type, item.format,
    item.duration_hours, Number(item.mandatory), JSON.stringify(item.target_roles), JSON.stringify(item.target_grades),
    JSON.stringify(item.develops_skills), JSON.stringify(item.prerequisites), JSON.stringify(item.upcoming_sessions));
  const activities = new ActivityRepository(db);
  for (const item of source.history) activities.insert(item);
}

describe("deterministic same-day completion replay", () => {
  it("previews the same capped skill result regardless of input record order", () => {
    const source = fixture();
    const before = structuredClone(source);
    const preview = previewActivityCompletion(normalizeDataset(source), employeeId, "ORDER_A");
    expect(preview.allowed).toBe(true);
    if (!preview.allowed) throw new Error("Expected an eligible completion");
    // The earlier event ID teaches 1->2 before the uncapped event adds 2: final 4.
    // Appending the virtual record after same-day records previously predicted 3.
    expect(preview.preview.effectiveSkills[skillId]).toBe(4);
    expect(preview.preview.progress).toEqual({ before: 75, after: 100, delta: 25 });
    const completed = record("ORDER_A", "LOCAL_SAME_DAY");
    for (const history of [[...source.history, completed], [completed, ...source.history]]) {
      const after = getEmployeeView(normalizeDataset({ ...source, history }), employeeId);
      expect(after.effectiveSkills).toEqual(preview.preview.effectiveSkills);
      expect(after.skillGaps).toEqual(preview.preview.skillGaps);
    }
    expect(source).toEqual(before);
  });
});

describe("SQLite replay matches normalized preview order", () => {
  let directory: string;
  beforeEach(() => {
    closeDatabase();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-completion-order-"));
    vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "test.sqlite"));
    vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
    vi.stubEnv("AI_EXPLANATIONS_ENABLED", "false");
    vi.stubEnv("OPENAI_API_KEY", "");
  });
  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("persists exactly the previewed result when the new event sorts before a same-day completion", async () => {
    const db = getDatabase();
    const source = fixture();
    insertFixture(db, source);
    const preview = previewActivityCompletion(normalizeDataset(loadDomainDataset(db)), employeeId, "ORDER_A");
    expect(preview.allowed).toBe(true);
    if (!preview.allowed) throw new Error("Expected an eligible completion");
    const result = await completeActivity(employeeId, "ORDER_A", {}, db);
    expect(result.view.effectiveSkills[skillId]).toBe(4);
    expect(result.view.effectiveSkills).toEqual(preview.preview.effectiveSkills);
    expect(result.view.skillGaps).toEqual(preview.preview.skillGaps);
    expect(result.progress).toEqual(preview.preview.progress);
    expect(result.activity.date).toBe(preview.completedAt);
    expect(result.view.employee.skills).toEqual(source.employees[0].skills);
  });

  it("uses identical date/event/record order in normalization and both repository reads", () => {
    const db = getDatabase();
    const source = fixture();
    const ids = ["ORDER_\u{10000}", "ORDER_\uE000", "ORDER_a", "ORDER_Z", "ORDER_A"];
    source.events = ids.map((id) => event(id, 1, 5));
    source.history = [
      ...ids.map((id, index) => record(id, `R_${index}`)),
      record("ORDER_A", "R_\u{10000}"), record("ORDER_A", "R_\uE000"),
      record("ORDER_A", "R_a"), record("ORDER_A", "R_Z"), record("ORDER_Z", "EARLIER", "2026-09-30"),
    ];
    const originalHistory = structuredClone(source.history);
    insertFixture(db, source);
    const expectedIds = ["EARLIER", "R_4", "R_Z", "R_a", "R_\uE000", "R_\u{10000}", "R_3", "R_2", "R_1", "R_0"];
    const activities = new ActivityRepository(db);
    expect(activities.listAll().filter((item) => item.employee_id === employeeId).map((item) => item.record_id)).toEqual(expectedIds);
    expect(activities.listByEmployee(employeeId).map((item) => item.record_id)).toEqual(expectedIds);
    expect(normalizeDataset(source).historyByEmployeeId.get(employeeId)!.map((item) => item.record_id)).toEqual(expectedIds);
    expect(normalizeDataset({ ...source, history: [...source.history].reverse() }).historyByEmployeeId.get(employeeId)!.map((item) => item.record_id)).toEqual(expectedIds);
    expect(source.history).toEqual(originalHistory);
  });
});

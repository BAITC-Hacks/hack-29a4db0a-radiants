import type { ActivityRecord, CareerDataset } from "../../src/types/career";
import { demoDataset } from "./career-dataset";

export function completionDataset(): CareerDataset {
  const source = structuredClone(demoDataset);
  return {
    ...source,
    employees: [{ ...source.employees[0]!, employee_id: "UNSEEN_PERSON", skills: { SK_SYS: 2, SK_CLOUD: 4 } }],
    events: [{
      ...source.events[0]!, event_id: "UNSEEN_EVENT", prerequisites: { SK_SYS: 2 },
      develops_skills: [
        { skill_id: "SK_SYS", gain: 1, max_level: 3 },
        { skill_id: "SK_CLOUD", gain: 1, max_level: 3 },
      ],
    }],
    history: [],
  };
}

export function participation(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    record_id: "PARTICIPATION", employee_id: "UNSEEN_PERSON", event_id: "UNSEEN_EVENT",
    date: "2026-09-25", due_date: null, status: "in_progress", completion_pct: 50,
    score: null, feedback_rating: null, assigned_by: "self", ...overrides,
  };
}

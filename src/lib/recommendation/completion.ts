import { normalizeDataset, type NormalizedDataset } from "../data/normalize";
import type { ActivityRecord, EmployeeView, ExpectedChange, SkillGap, SkillLevel } from "../../types/career";
import { getEmployeeView, reconstructEffectiveSkills, resolveTarget } from "./index";
import { getNextSession, getUnmetPrerequisites, matchesAudience, SNAPSHOT_DATE } from "./eligibility";

export interface CompletionContext {
  /** Omit for the snapshot day or the nearest available scheduled session. */
  completedAt?: string;
}

export type CompletionRefusalCode =
  | "employee_not_found" | "event_not_found" | "audience" | "prerequisites"
  | "completed" | "unavailable" | "mandatory_assignment_required" | "invalid_completion_date";

export interface CompletionRefusal {
  code: CompletionRefusalCode;
  message: string;
  missingSkills?: Array<{ skillId: string; current: number; required: number }>;
}

export type CompletionDecision =
  | { allowed: false; reasons: CompletionRefusal[] }
  | { allowed: true; completedAt: string; continuingRecordId?: string };

/** Domain policy only. The server must still authorize the actor and hold a write transaction. */
export function checkActivityCompletion(
  dataset: NormalizedDataset,
  employeeId: string,
  eventId: string,
  context: CompletionContext = {},
): CompletionDecision {
  const employee = dataset.employeeById.get(employeeId);
  const event = dataset.eventById.get(eventId);
  if (!employee) return { allowed: false, reasons: [{ code: "employee_not_found", message: "Employee does not exist." }] };
  if (!event) return { allowed: false, reasons: [{ code: "event_not_found", message: "Activity does not exist." }] };

  const reasons: CompletionRefusal[] = [];
  const skills = reconstructEffectiveSkills(employee, dataset);
  const target = resolveTarget(employee, dataset);
  const history = dataset.historyByEmployeeId.get(employeeId) ?? [];
  const records = history.filter((record) => record.event_id === eventId);
  const active = activeParticipation(records);
  if (event.mandatory && (!active || active.assigned_by === "self")) {
    reasons.push({ code: "mandatory_assignment_required", message: "Mandatory completion requires an active manager/HR assignment in stored history." });
  }
  if (!matchesAudience(event, employee, target)) {
    reasons.push({ code: "audience", message: "Activity does not match the current or target role and grade." });
  }
  const missingSkills = getUnmetPrerequisites(event, skills);
  if (missingSkills.length > 0) {
    reasons.push({ code: "prerequisites", message: "Activity prerequisites are not met.", missingSkills });
  }
  if (eventId !== "EV_036" && records.some((record) => record.status === "completed")) {
    reasons.push({ code: "completed", message: "Activity is already completed; only EV_036 can be repeated." });
  }

  // A persisted active participation may finish today even after its original session.
  // New scheduled activities must use a listed future session, never an arbitrary client date.
  const completesToday = event.format === "self_paced" || active !== undefined;
  const defaultDate = completesToday ? SNAPSHOT_DATE : getNextSession(event);
  if (!defaultDate) {
    reasons.push({ code: "unavailable", message: `No session is available on or after ${SNAPSHOT_DATE}.` });
  }
  const completedAt = context.completedAt ?? defaultDate;
  if (context.completedAt !== undefined && (
    !isIsoDate(context.completedAt) ||
    (completesToday
      ? context.completedAt !== SNAPSHOT_DATE
      : context.completedAt < SNAPSHOT_DATE || !event.upcoming_sessions.includes(context.completedAt))
  )) {
    reasons.push({ code: "invalid_completion_date", message: "Use the snapshot day for self-paced/active participation, or a listed session on/after the snapshot for a new scheduled activity." });
  }
  if (reasons.length > 0 || completedAt === undefined) return { allowed: false, reasons };
  return { allowed: true, completedAt, ...(active ? { continuingRecordId: active.record_id } : {}) };
}

export interface CompletionPreview {
  employeeId: string;
  eventId: string;
  target: EmployeeView["target"];
  progress: { before: number; after: number; delta: number };
  expectedChanges: ExpectedChange[];
  effectiveSkills: Record<string, SkillLevel>;
  skillGaps: SkillGap[];
}

export type CompletionPreviewResult =
  | Extract<CompletionDecision, { allowed: false }>
  | (Extract<CompletionDecision, { allowed: true }> & { preview: CompletionPreview });

/** One independent completion, using the same history reconstruction as the persisted view. */
export function previewActivityCompletion(
  dataset: NormalizedDataset,
  employeeId: string,
  eventId: string,
  context: CompletionContext = {},
): CompletionPreviewResult {
  const decision = checkActivityCompletion(dataset, employeeId, eventId, context);
  if (!decision.allowed) return decision;
  const before = getEmployeeView(dataset, employeeId);
  const event = dataset.eventById.get(eventId)!;
  const usedIds = new Set(dataset.history.map((record) => record.record_id));
  let recordId = "COMPLETION_PREVIEW";
  while (usedIds.has(recordId)) recordId += "_";
  const record: ActivityRecord = {
    record_id: recordId, employee_id: employeeId, event_id: eventId, date: decision.completedAt,
    due_date: null, status: "completed", completion_pct: 100, score: null, feedback_rating: null,
    assigned_by: "self",
  };
  const after = getEmployeeView(normalizeDataset({ ...dataset, history: [...dataset.history, record] }), employeeId);
  const expectedChanges = [...new Set(event.develops_skills.map((effect) => effect.skill_id))].map((skillId) => {
    const gap = before.skillGaps.find((item) => item.skillId === skillId);
    return {
      skillId, before: before.effectiveSkills[skillId] ?? 0, after: after.effectiveSkills[skillId] ?? 0,
      required: gap?.requiredLevel ?? 0, critical: gap?.critical ?? false,
    };
  });
  return {
    ...decision,
    preview: {
      employeeId, eventId, target: before.target,
      progress: { before: before.readiness, after: after.readiness, delta: Math.round((after.readiness - before.readiness) * 10) / 10 },
      expectedChanges, effectiveSkills: after.effectiveSkills, skillGaps: after.skillGaps,
    },
  };
}

function activeParticipation(records: ActivityRecord[]): ActivityRecord | undefined {
  // At an ambiguous same-day tie, a terminal record takes precedence over an active one.
  const isActive = (record: ActivityRecord) => record.status === "in_progress" || record.status === "overdue";
  const latest = [...records].sort((left, right) =>
    right.date.localeCompare(left.date) || Number(isActive(left)) - Number(isActive(right)) || left.record_id.localeCompare(right.record_id),
  )[0];
  return latest && isActive(latest) && latest.date <= SNAPSHOT_DATE ? latest : undefined;
}

function isIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const milliseconds = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === date;
}

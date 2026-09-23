import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CatalogResult, CompleteActivityResult, EmployeeCard, EmployeeDetail, HrSummaryResult } from "@/contracts/api";
import { SNAPSHOT_DATE, REPEATABLE_EVENT_ID, type ActivityRecord } from "@/contracts/types";
import { getEmployeeView } from "@/lib/recommendation";
import { normalizeDataset, type NormalizedDataset } from "@/lib/data/normalize";
import { buildHrSummary } from "@/lib/analytics/hr-summary";
import { applyAiExplanations, type RecommendationExplainer } from "@/lib/ai/explanations";
import { createOpenAIExplainer } from "@/lib/ai/openai-explainer";
import { AppError } from "@/server/errors";
import { getDatabase } from "@/server/db/database";
import { ActivityRepository, EmployeeRepository, EventRepository, SkillRepository, loadDomainDataset, type EmployeeFilters } from "@/server/repositories";

function normalized(db: Database.Database): NormalizedDataset {
  return normalizeDataset(loadDomainDataset(db));
}

function employeeDetail(dataset: NormalizedDataset, employeeId: string): EmployeeDetail {
  if (!dataset.employeeById.has(employeeId)) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee " + employeeId + " was not found");
  const view = getEmployeeView(dataset, employeeId);
  const history = dataset.historyByEmployeeId.get(employeeId) ?? [];
  const completed = history.filter((record) => record.status === "completed");
  const activityView = (record: ActivityRecord) => ({ ...record, eventTitle: dataset.eventById.get(record.event_id)?.title ?? record.event_id });
  return {
    ...view,
    completedActivities: completed.map(activityView),
    activeMandatoryObligations: history.filter((record) =>
      record.status !== "completed" && dataset.eventById.get(record.event_id)?.mandatory &&
      !completed.some((done) => done.event_id === record.event_id && done.date >= record.date)
    ).map(activityView),
  };
}

export function listEmployees(filters: EmployeeFilters): EmployeeCard[] {
  return new EmployeeRepository().list(filters).map((employee) => ({
    employeeId: employee.employee_id, fullName: employee.full_name,
    department: employee.department, role: employee.role, grade: employee.grade,
    workFormat: employee.work_format, preferredLanguage: employee.preferred_language,
    hasCareerGoal: employee.career_goal !== null,
  }));
}

export function getCatalog(db: Database.Database = getDatabase()): CatalogResult {
  const skills = new SkillRepository(db);
  return { events: new EventRepository(db).list(), skills: skills.listSkills(), roleProfiles: skills.listRoleProfiles() };
}

export function getEmployeeProjection(employeeId: string, db: Database.Database = getDatabase()): EmployeeDetail {
  return employeeDetail(normalized(db), employeeId);
}

export async function getRecommendations(
  employeeId: string,
  db: Database.Database = getDatabase(),
  explainer?: RecommendationExplainer,
): Promise<EmployeeDetail> {
  const detail = getEmployeeProjection(employeeId, db);
  const provider = explainer ?? createOpenAIExplainer({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || undefined,
  });
  // Network work stays outside completion transactions and never changes stored skills/history.
  const enriched = await applyAiExplanations(detail, provider);
  return { ...detail, recommendations: enriched.recommendations };
}

export function getHrSummary(filters: EmployeeFilters, db: Database.Database = getDatabase()): HrSummaryResult {
  const dataset = loadDomainDataset(db);
  const employees = new EmployeeRepository(db).list(filters);
  const ids = new Set(employees.map((employee) => employee.employee_id));
  const history = dataset.history.filter((record) => ids.has(record.employee_id));
  const scoped = normalizeDataset({ ...dataset, employees, history });
  const summary = buildHrSummary(scoped);
  const participationByStatus: HrSummaryResult["participationByStatus"] = { completed: 0, in_progress: 0, dropped: 0, no_show: 0, declined: 0, overdue: 0 };
  const assignedBy: HrSummaryResult["assignedBy"] = { self: 0, manager: 0, hr: 0 };
  for (const record of history) { participationByStatus[record.status]++; assignedBy[record.assigned_by]++; }
  return {
    ...summary, population: employees.length, filters, totalActivities: history.length,
    participationByStatus, assignedBy,
    completionRate: history.length ? Math.round(participationByStatus.completed / history.length * 1000) / 10 : 0,
    totalGapSeverity: employees.reduce((sum, employee) => sum + getEmployeeView(scoped, employee.employee_id).skillGaps.reduce((n, gap) => n + gap.gap, 0), 0),
    employeesWithoutTarget: summary.employeesWithoutRecommendations.filter((item) => item.reason === "needs_career_goal"),
  };
}

export async function completeActivity(
  employeeId: string,
  eventId: string,
  values: { completedAt?: string; score?: number | null; feedbackRating?: number | null },
  db: Database.Database = getDatabase(),
): Promise<CompleteActivityResult> {
  // The lock covers existence/duplicate checks, insertion and the recomputed view.
  return db.transaction(() => {
    const before = getEmployeeProjection(employeeId, db);
    const event = new EventRepository(db).getById(eventId);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event " + eventId + " was not found");
    const activities = new ActivityRepository(db);
    if (eventId !== REPEATABLE_EVENT_ID && activities.hasCompleted(employeeId, eventId)) {
      throw new AppError(409, "EVENT_ALREADY_COMPLETED", "This event cannot be completed more than once");
    }
    const date = values.completedAt ?? (event.format === "self_paced" ? SNAPSHOT_DATE : [...event.upcoming_sessions].filter((session) => session >= SNAPSHOT_DATE).sort()[0]);
    if (!date) throw new AppError(422, "EVENT_NOT_AVAILABLE", "A completion date is required because this event has no future session");
    const activity: ActivityRecord = {
      record_id: "LOCAL_" + randomUUID(), employee_id: employeeId, event_id: eventId,
      date, due_date: null, status: "completed", completion_pct: 100,
      score: values.score ?? null, feedback_rating: values.feedbackRating ?? null, assigned_by: "self",
    };
    activities.insert(activity);
    // Assessed employee.skills is never changed: history is the sole source of this gain.
    const view = getEmployeeProjection(employeeId, db);
    return { activity, view, progress: { before: before.readiness, after: view.readiness, delta: Math.round((view.readiness - before.readiness) * 10) / 10 } };
  }).immediate();
}

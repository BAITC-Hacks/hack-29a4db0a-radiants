import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CareerGoalUpdate, CatalogResult, CompleteActivityResult, EmployeeCard, EmployeeDetail, HrSummaryResult } from "@/contracts/api";
import { REPEATABLE_EVENT_ID, type ActivityRecord } from "@/contracts/types";
import { careerGoalUpdateSchema } from "@/contracts/schemas";
import { getCompletionEligibility, getEmployeeView, getRecommendationDiagnostics } from "@/lib/recommendation";
import { normalizeDataset, type NormalizedDataset } from "@/lib/data/normalize";
import { buildHrSummary } from "@/lib/analytics/hr-summary";
import { applyAiExplanations, type RecommendationExplainer } from "@/lib/ai/explanations";
import { createOpenAIExplainer } from "@/lib/ai/openai-explainer";
import { AppError } from "@/server/errors";
import { audit } from "@/server/auth";
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
    activityHistory: history.map(activityView),
    recommendationDiagnostics: getRecommendationDiagnostics(dataset, employeeId),
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

export const AI_REQUEST_BUDGET_MS = 9_500;

export async function getRecommendations(
  employeeId: string,
  db?: Database.Database,
  explainer?: RecommendationExplainer,
  deadline = performance.now() + AI_REQUEST_BUDGET_MS,
): Promise<EmployeeDetail> {
  const detail = getEmployeeProjection(employeeId, db ?? getDatabase());
  // Internal deployments can explicitly prohibit sending any evidence to an external model.
  if (process.env.AI_EXPLANATIONS_ENABLED?.trim().toLowerCase() === "false") return detail;
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0 || !detail.recommendations.length) return detail;
  const provider = explainer ?? createOpenAIExplainer({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || undefined,
    timeoutMs: Math.min(8_000, remainingMs),
  });
  // Network work stays outside completion transactions and never changes stored skills/history.
  // Reserve 500 ms for serialization/transport; late provider results cannot replace fallback.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const enriched = await Promise.race([
      applyAiExplanations(detail, provider),
      new Promise<EmployeeDetail>((resolve) => { timer = setTimeout(() => resolve(detail), remainingMs); }),
    ]);
    return { ...detail, recommendations: enriched.recommendations };
  } finally {
    clearTimeout(timer);
  }
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
  actorUserId?: string,
): Promise<CompleteActivityResult> {
  // Eligibility is evaluated against the same locked snapshot as the write and view.
  return db.transaction(() => {
    const dataset = normalized(db);
    const before = employeeDetail(dataset, employeeId);
    const event = dataset.eventById.get(eventId);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event " + eventId + " was not found");
    const activities = new ActivityRepository(db);
    if (eventId !== REPEATABLE_EVENT_ID && activities.hasCompleted(employeeId, eventId)) {
      throw new AppError(409, "EVENT_ALREADY_COMPLETED", "This event cannot be completed more than once");
    }
    const eligibility = getCompletionEligibility(dataset, employeeId, eventId, values.completedAt);
    if (!eligibility.eligible || !eligibility.completionDate) {
      throw new AppError(422, "EVENT_NOT_ELIGIBLE", "This activity cannot be completed: " + eligibility.reasons.map((reason) => reason.message).join(" "),
        eligibility.reasons.map((reason) => ({ field: reason.code === "invalid_completion_date" ? "completedAt" : "eventId", message: `${reason.code}: ${reason.message}` })));
    }
    const activity: ActivityRecord = {
      record_id: "LOCAL_" + randomUUID(), employee_id: employeeId, event_id: eventId,
      date: eligibility.completionDate, due_date: null, status: "completed", completion_pct: 100,
      score: values.score ?? null, feedback_rating: values.feedbackRating ?? null, assigned_by: "self",
    };
    activities.insert(activity);
    // Assessed employee.skills is never changed: history is the sole source of this gain.
    const view = getEmployeeProjection(employeeId, db);
    if (actorUserId) audit(actorUserId, "activity.completed", activity.record_id, db);
    return { activity, view, progress: { before: before.readiness, after: view.readiness, delta: Math.round((view.readiness - before.readiness) * 10) / 10 } };
  }).immediate();
}

export function updateCareerGoal(
  employeeId: string,
  values: CareerGoalUpdate,
  db: Database.Database = getDatabase(),
  actorUserId?: string,
): EmployeeDetail {
  return db.transaction(() => {
    const { career_goal: goal } = careerGoalUpdateSchema.parse(values);
    const employees = new EmployeeRepository(db);
    if (!employees.exists(employeeId)) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee " + employeeId + " was not found");
    if (goal && !new SkillRepository(db).listRoleProfiles().some((profile) =>
      profile.role === goal.target_role && profile.grade === goal.target_grade)) {
      throw new AppError(422, "INVALID_CAREER_TARGET", "Choose a role and grade present in the role profiles catalog",
        [{ field: "career_goal", message: "The requested role/grade pair does not exist" }]);
    }
    // This statement cannot touch assessed skills, present position, or accounts.
    employees.setCareerGoal(employeeId, goal);
    const view = getEmployeeProjection(employeeId, db);
    if (actorUserId) audit(actorUserId, "career_goal.updated", employeeId, db);
    return view;
  }).immediate();
}

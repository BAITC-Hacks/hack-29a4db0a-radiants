import type { Employee, EmployeeView, Recommendation } from "../../types/career";
import type { ActivityView, EmployeeDetail } from "../../contracts/api";
import type { EmployeeListItem, HrSummaryResponse, ImportResult } from "./api";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const optionalText = (value: unknown) => value === undefined || text(value);
const level = (value: unknown) => number(value) && value >= 0 && value <= 5;
const grade = (value: unknown) => ["Junior", "Middle", "Senior", "Lead"].includes(String(value));
const skillMap = (value: unknown) => object(value) && Object.values(value).every((n) => level(n) && Number.isInteger(n));
const percent = (value: unknown) => number(value) && value >= 0 && value <= 100;
const count = (value: unknown) => number(value) && value >= 0 && Number.isInteger(value);

/** Shape checks only: no normalization, eligibility, ranking, or progress formulas. */
function isEmployee(value: unknown): value is Employee {
  return object(value) && text(value.employee_id) && !!value.employee_id && text(value.full_name) &&
    text(value.department) && text(value.role) && grade(value.grade) &&
    number(value.tenure_months) && text(value.hire_date) && text(value.last_review_date) &&
    (value.manager_id === null || text(value.manager_id)) && skillMap(value.skills) &&
    ["office", "hybrid", "remote"].includes(String(value.work_format)) &&
    ["kk", "ru", "en"].includes(String(value.preferred_language)) &&
    (value.career_goal === null || (object(value.career_goal) &&
      text(value.career_goal.target_role) && grade(value.career_goal.target_grade)));
}
export function isEmployeeList(value: unknown): value is EmployeeListItem[] {
  return Array.isArray(value) && value.every((item) => object(item) && text(item.employee_id) && !!item.employee_id && text(item.full_name) && text(item.role)) &&
    new Set(value.map((employee) => employee.employee_id)).size === value.length;
}
function isRecommendation(value: unknown): value is Recommendation {
  return object(value) && text(value.eventId) && text(value.title) && number(value.score) &&
    strings(value.reasons) && text(value.historySignal) && optionalText(value.nextSession) &&
    optionalText(value.aiExplanation) && text(value.deterministicExplanation) &&
    ["llm", "fallback"].includes(String(value.explanationSource)) &&
    (value.explanationSource !== "llm" || (text(value.aiExplanation) && !!value.aiExplanation.trim())) &&
    Array.isArray(value.expectedChanges) && value.expectedChanges.every((change) =>
      object(change) && text(change.skillId) && level(change.before) && level(change.after) &&
      level(change.required) && typeof change.critical === "boolean");
}
function isActivityView(value: unknown): value is ActivityView {
  return object(value) && text(value.record_id) && text(value.employee_id) && text(value.event_id) &&
    text(value.eventTitle) && text(value.date) && (value.due_date === null || text(value.due_date)) && percent(value.completion_pct) &&
    ["completed", "in_progress", "dropped", "no_show", "declined", "overdue"].includes(String(value.status)) &&
    (value.score === null || number(value.score)) &&
    (value.feedback_rating === null || number(value.feedback_rating)) &&
    ["self", "manager", "hr"].includes(String(value.assigned_by));
}
export function isEmployeeDetail(value: unknown): value is EmployeeDetail {
  if (!isEmployeeView(value)) return false;
  const detail = value as unknown as ObjectValue;
  return Array.isArray(detail.completedActivities) && detail.completedActivities.every(isActivityView) &&
    Array.isArray(detail.activeMandatoryObligations) && detail.activeMandatoryObligations.every(isActivityView);
}
export function isEmployeeView(value: unknown): value is EmployeeView {
  return object(value) && isEmployee(value.employee) && percent(value.readiness) &&
    (value.target === null || (object(value.target) && text(value.target.role) && grade(value.target.grade))) &&
    ["active", "needs_career_goal"].includes(String(value.targetStatus)) &&
    skillMap(value.effectiveSkills) && Array.isArray(value.skillGaps) &&
    value.skillGaps.every((gap) => object(gap) && text(gap.skillId) && text(gap.name) &&
      level(gap.currentLevel) && level(gap.projectedLevel) && level(gap.requiredLevel) &&
      number(gap.gap) && gap.gap >= 0 && typeof gap.critical === "boolean") &&
    Array.isArray(value.recommendations) && value.recommendations.every(isRecommendation);
}
export function isHrSummary(value: unknown): value is HrSummaryResponse {
  if (!object(value) || !Array.isArray(value.weakCompetencies) ||
      !Array.isArray(value.employeesWithoutRecommendations) || !Array.isArray(value.participationByEvent)) return false;
  if (!value.weakCompetencies.every((row) => object(row) && text(row.skillId) && text(row.name) &&
      count(row.employeesBelowRequirement))) return false;
  if (!value.employeesWithoutRecommendations.every((row) => object(row) && text(row.employeeId) &&
      text(row.fullName) && ["needs_career_goal", "no_eligible_step"].includes(String(row.reason)))) return false;
  if (!value.participationByEvent.every((row) => object(row) && text(row.eventId) && text(row.title) &&
      count(row.total) && object(row.byStatus) && Object.values(row.byStatus).every(count))) return false;
  if (value.metrics !== undefined) {
    if (!object(value.metrics)) return false;
    if (value.metrics.totalEmployees !== undefined && !count(value.metrics.totalEmployees)) return false;
    if (value.metrics.completionRate !== undefined && !percent(value.metrics.completionRate)) return false;
    if (value.metrics.coverage !== undefined && !percent(value.metrics.coverage)) return false;
  }
  return true;
}
export function isImportResult(value: unknown): value is ImportResult {
  return object(value) && (value.success === undefined || value.success === true) &&
    (value.employeeIds === undefined || strings(value.employeeIds)) &&
    (value.warnings === undefined || strings(value.warnings)) && optionalText(value.message) &&
    (value.success === true || Array.isArray(value.employeeIds) || text(value.message));
}

import type { Employee, EmployeeView, Recommendation } from "../../types/career";
import type { ActivityView, CatalogResult, EmployeeDetail, RecommendationDiagnostics } from "../../contracts/api";
import type { SessionUser } from "../../contracts/auth";
import type { EmployeeAccount, EmployeeListItem, HrSummaryResponse, ImportResult } from "./api";

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

export function isSessionUser(value: unknown): value is SessionUser {
  return object(value) && text(value.id) && !!value.id && text(value.username) && !!value.username &&
    (value.role === "employee" ? text(value.employeeId) && !!value.employeeId : value.role === "hr" && value.employeeId === null);
}
export function isAccounts(value: unknown): value is EmployeeAccount[] {
  return Array.isArray(value) && value.every((item) => isSessionUser(item) && object(item) && typeof item.active === "boolean") &&
    new Set(value.map((item) => item.id)).size === value.length &&
    new Set(value.map((item) => item.username.toLowerCase())).size === value.length;
}

export function isCatalog(value: unknown): value is CatalogResult {
  return object(value) && Array.isArray(value.skills) && value.skills.every((skill) =>
    object(skill) && text(skill.skill_id) && !!skill.skill_id && text(skill.name) && !!skill.name &&
    ["hard", "soft"].includes(String(skill.type)) && text(skill.category) && text(skill.description)) &&
    new Set(value.skills.map((skill) => skill.skill_id)).size === value.skills.length &&
    Array.isArray(value.roleProfiles) && value.roleProfiles.every((profile) =>
      object(profile) && text(profile.role) && grade(profile.grade) && skillMap(profile.required_skills) && strings(profile.critical_skills)) &&
    Array.isArray(value.events) && value.events.every((event) =>
      object(event) && text(event.event_id) && text(event.title) && text(event.description) &&
      ["compliance", "onboarding", "course", "workshop", "mentoring", "certification", "meetup"].includes(String(event.type)) &&
      ["online", "offline", "self_paced"].includes(String(event.format)) && number(event.duration_hours) && typeof event.mandatory === "boolean" &&
      strings(event.target_roles) && Array.isArray(event.target_grades) && event.target_grades.every(grade) &&
      skillMap(event.prerequisites) && strings(event.upcoming_sessions) && Array.isArray(event.develops_skills) &&
      event.develops_skills.every((effect) => object(effect) && text(effect.skill_id) && number(effect.gain) && level(effect.max_level)));
}

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
  return Array.isArray(value) && value.every((item) => object(item) && text(item.employee_id) && !!item.employee_id && text(item.full_name) && text(item.role) &&
    (item.grade === undefined || grade(item.grade)) && optionalText(item.department)) &&
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
    Array.isArray(detail.activeMandatoryObligations) && detail.activeMandatoryObligations.every(isActivityView) &&
    Array.isArray(detail.activityHistory) && detail.activityHistory.every(isActivityView) &&
    isRecommendationDiagnostics(detail.recommendationDiagnostics);
}
function isRecommendationDiagnostics(value: unknown): value is RecommendationDiagnostics {
  const codes = ["mandatory", "audience", "prerequisites", "unavailable", "completed", "in_progress", "no_gap_reduction"];
  return object(value) && ["available", "needs_career_goal", "target_reached", "no_eligible_events"].includes(String(value.status)) &&
    text(value.summary) && text(value.snapshotDate) && count(value.catalogEventCount) && count(value.evaluatedEventCount) &&
    count(value.eligibleEventCount) && count(value.remainingGapCount) && object(value.exclusionCounts) &&
    codes.every((code) => count((value.exclusionCounts as ObjectValue)[code])) &&
    Array.isArray(value.blockedEvents) && value.blockedEvents.every((event) => object(event) && text(event.eventId) && text(event.title) &&
      Array.isArray(event.reasons) && event.reasons.every((reason) => object(reason) && codes.includes(String(reason.code)) && text(reason.message))) &&
    object(value.readinessExplanation) && text(value.readinessExplanation.formula) && value.readinessExplanation.criticalWeight === 2 &&
    value.readinessExplanation.standardWeight === 1 && value.readinessExplanation.precision === 1;
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

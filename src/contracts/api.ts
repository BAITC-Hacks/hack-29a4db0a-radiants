import type { ActivityRecord, ActivityStatus, CareerDataset, Employee, EmployeeView } from "@/types/career";
import type { HrSummary } from "@/lib/analytics/hr-summary";
import type { RecommendationDiagnostics } from "@/lib/recommendation";
export type { RecommendationDiagnostics, RecommendationExclusion, RecommendationExclusionCode } from "@/lib/recommendation";

export interface ApiSuccess<T> { data: T }
export interface ApiErrorDetail { file?: string; row?: number; field?: string; message: string }
export interface ApiError { error: { code: string; message: string; details: ApiErrorDetail[] } }
export interface ImportResult { employeesInserted: number; employeesUpdated: number; historyInserted: number; historySkipped: number }
export interface HealthResult {
  status: "ok";
  schemaVersion: number;
  counts: { skills: number; roleProfiles: number; employees: number; events: number; activityHistory: number };
}
export interface EmployeeCard {
  employeeId: string;
  fullName: string;
  department: string;
  role: string;
  grade: Employee["grade"];
  workFormat: Employee["work_format"];
  preferredLanguage: Employee["preferred_language"];
  hasCareerGoal: boolean;
}
export interface EmployeeListResult { items: EmployeeCard[]; total: number }
export type CatalogResult = Pick<CareerDataset, "events" | "skills" | "roleProfiles">;
export interface ActivityView extends ActivityRecord { eventTitle: string }
export interface EmployeeDetail extends EmployeeView {
  activityHistory: ActivityView[];
  completedActivities: ActivityView[];
  activeMandatoryObligations: ActivityView[];
  recommendationDiagnostics: RecommendationDiagnostics;
}
export interface CompleteActivityResult {
  activity: ActivityRecord;
  view: EmployeeDetail;
  progress: { before: number; after: number; delta: number };
}
export interface CareerGoalUpdate { career_goal: Employee["career_goal"] }
export interface HrFilters { role?: string; grade?: Employee["grade"]; department?: string }
export interface HrSummaryResult extends HrSummary {
  population: number;
  filters: HrFilters;
  totalActivities: number;
  participationByStatus: Record<ActivityStatus, number>;
  assignedBy: Record<ActivityRecord["assigned_by"], number>;
  completionRate: number;
  totalGapSeverity: number;
  employeesWithoutTarget: HrSummary["employeesWithoutRecommendations"];
}

export const SNAPSHOT_DATE = "2026-10-01";
export const REPEATABLE_EVENT_ID = "EV_036";

export const GRADES = ["Junior", "Middle", "Senior", "Lead"] as const;
export type Grade = (typeof GRADES)[number];

export type SkillType = "hard" | "soft";
export type WorkFormat = "office" | "hybrid" | "remote";
export type PreferredLanguage = "kk" | "ru" | "en";
export type ActivityStatus =
  | "completed"
  | "in_progress"
  | "dropped"
  | "no_show"
  | "declined"
  | "overdue";
export type AssignedBy = "self" | "manager" | "hr";
export type EventFormat = "online" | "offline" | "self_paced";

export interface Skill {
  skill_id: string;
  name: string;
  type: SkillType;
  category: string;
  description: string;
}

export interface RoleProfile {
  role: string;
  grade: Grade;
  required_skills: Record<string, number>;
  critical_skills: string[];
}

export interface CareerGoal {
  target_role: string;
  target_grade: Grade;
}

export interface Employee {
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  grade: Grade;
  manager_id: string | null;
  hire_date: string;
  tenure_months: number;
  work_format: WorkFormat;
  preferred_language: PreferredLanguage;
  career_goal: CareerGoal | null;
  skills: Record<string, number>;
  last_review_date: string;
}

export interface EventSkillEffect {
  skill_id: string;
  gain: number;
  max_level: number;
}

export interface DevelopmentEvent {
  event_id: string;
  title: string;
  description: string;
  type: string;
  format: EventFormat;
  duration_hours: number;
  mandatory: boolean;
  target_roles: string[];
  target_grades: Grade[];
  develops_skills: EventSkillEffect[];
  prerequisites: Record<string, number>;
  upcoming_sessions: string[];
}

export interface ActivityRecord {
  record_id: string;
  employee_id: string;
  event_id: string;
  date: string;
  due_date: string | null;
  status: ActivityStatus;
  completion_pct: number;
  score: number | null;
  feedback_rating: number | null;
  assigned_by: AssignedBy;
}

export interface DomainDataset {
  skills: Skill[];
  roleProfiles: RoleProfile[];
  employees: Employee[];
  events: DevelopmentEvent[];
  activities: ActivityRecord[];
}

export interface SkillGap {
  skillId: string;
  name: string;
  currentLevel: number;
  requiredLevel: number;
  gap: number;
  critical: boolean;
}

export interface CareerTarget {
  role: string;
  grade: Grade;
  source: "career_goal" | "next_grade";
}

export interface ActivityView extends ActivityRecord {
  eventTitle: string;
  eventType: string;
  eventFormat: EventFormat;
}

export interface MandatoryObligation extends ActivityView {
  dueDate: string | null;
}

export interface EmployeeProjection {
  employee: Employee;
  target: CareerTarget | null;
  targetStatus: "ready" | "no_target";
  effectiveSkills: Record<string, number>;
  readiness: number | null;
  skillGaps: SkillGap[];
  completedActivities: ActivityView[];
  activeMandatoryObligations: MandatoryObligation[];
}

export interface RecommendationSkillImpact {
  skillId: string;
  skillName: string;
  before: number;
  after: number;
  required: number;
  gapReduction: number;
  critical: boolean;
}

export interface RecommendationEvidence {
  target: CareerTarget;
  factors: string[];
  historySignals: string[];
  skillImpacts: RecommendationSkillImpact[];
}

export interface Recommendation {
  event: DevelopmentEvent;
  score: number;
  evidence: RecommendationEvidence;
  availability: {
    kind: "self_paced" | "scheduled";
    nextSession: string | null;
  };
  explanation: string;
}

export interface RecommendationResult {
  employeeId: string;
  target: CareerTarget | null;
  recommendations: Recommendation[];
  emptyReason: "no_target" | "no_eligible_events" | null;
  source: "deterministic" | "ai_enhanced";
}

export interface EmployeeDomainInput {
  employee: Employee;
  skills: Skill[];
  roleProfiles: RoleProfile[];
  events: DevelopmentEvent[];
  activities: ActivityRecord[];
}

export type RecommendationDomainInput = EmployeeDomainInput;

export interface HrFilters {
  role?: string;
  grade?: Grade;
  department?: string;
}

export interface HrDomainInput {
  dataset: DomainDataset;
  filters: HrFilters;
}

export interface HrSummary {
  population: number;
  filters: HrFilters;
  commonSkillGaps: Array<{
    skillId: string;
    skillName: string;
    employeesAffected: number;
    totalSeverity: number;
    criticalOccurrences: number;
  }>;
  employeesWithoutTarget: Array<{
    employeeId: string;
    fullName: string;
    role: string;
    grade: Grade;
  }>;
  employeesWithoutRecommendations: Array<{
    employeeId: string;
    fullName: string;
    role: string;
    grade: Grade;
  }>;
  participationByStatus: Record<ActivityStatus, number>;
  assignedBy: Record<AssignedBy, number>;
  completionRate: number;
  activityParticipation: Array<{
    eventId: string;
    title: string;
    participants: number;
    completed: number;
    completionRate: number;
  }>;
}

export interface CareerQuestDomainService {
  buildEmployeeProjection(input: EmployeeDomainInput): EmployeeProjection;
  recommend(input: RecommendationDomainInput): RecommendationResult;
  buildHrSummary(input: HrDomainInput): HrSummary;
}

export interface RecommendationEnhancer {
  enhance(
    result: RecommendationResult,
    input: RecommendationDomainInput,
  ): Promise<RecommendationResult>;
}

export const GRADES = ["Junior", "Middle", "Senior", "Lead"] as const;

export type Grade = (typeof GRADES)[number];
export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type ActivityStatus =
  | "completed"
  | "in_progress"
  | "dropped"
  | "no_show"
  | "declined"
  | "overdue";

export interface Skill {
  skill_id: string;
  name: string;
  type: "hard" | "soft";
  category: string;
  description: string;
}

export interface RoleProfile {
  role: string;
  grade: Grade;
  required_skills: Record<string, SkillLevel>;
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
  work_format: "office" | "hybrid" | "remote";
  preferred_language: "kk" | "ru" | "en";
  career_goal: CareerGoal | null;
  skills: Partial<Record<string, SkillLevel>>;
  last_review_date: string;
}

export interface EventSkillEffect {
  skill_id: string;
  gain: number;
  max_level: SkillLevel;
}

export interface DevelopmentEvent {
  event_id: string;
  title: string;
  description: string;
  type:
    | "compliance"
    | "onboarding"
    | "course"
    | "workshop"
    | "mentoring"
    | "certification"
    | "meetup";
  format: "online" | "offline" | "self_paced";
  duration_hours: number;
  mandatory: boolean;
  target_roles: string[];
  target_grades: Grade[];
  develops_skills: EventSkillEffect[];
  prerequisites: Partial<Record<string, SkillLevel>>;
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
  assigned_by: "self" | "manager" | "hr";
}

export interface CareerDataset {
  employees: Employee[];
  events: DevelopmentEvent[];
  skills: Skill[];
  roleProfiles: RoleProfile[];
  history: ActivityRecord[];
}

export interface SkillGap {
  skillId: string;
  name: string;
  currentLevel: number;
  projectedLevel: number;
  requiredLevel: number;
  gap: number;
  critical: boolean;
}

export interface ExpectedChange {
  skillId: string;
  before: number;
  after: number;
  required: number;
  critical: boolean;
}

export interface Recommendation {
  eventId: string;
  title: string;
  score: number;
  reasons: string[];
  expectedChanges: ExpectedChange[];
  historySignal: string;
  nextSession?: string;
  deterministicExplanation: string;
  aiExplanation?: string;
  explanationSource: "llm" | "fallback";
}

export interface EmployeeView {
  employee: Employee;
  target: { role: string; grade: Grade } | null;
  targetStatus: "active" | "needs_career_goal";
  effectiveSkills: Record<string, SkillLevel>;
  readiness: number;
  skillGaps: SkillGap[];
  recommendations: Recommendation[];
}

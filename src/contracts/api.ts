export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorDetail {
  file?: string;
  row?: number;
  field?: string;
  message: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
  };
}

export interface ImportResult {
  employeesInserted: number;
  employeesUpdated: number;
  historyInserted: number;
  historySkipped: number;
}

export interface HealthResult {
  status: "ok";
  schemaVersion: number;
  counts: {
    skills: number;
    roleProfiles: number;
    employees: number;
    events: number;
    activityHistory: number;
  };
}
import type { ActivityRecord, Employee, EmployeeProjection, RecommendationResult } from "./types";

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

export interface EmployeeListResult {
  items: EmployeeCard[];
  total: number;
}

export interface CompleteActivityResult {
  activity: ActivityRecord;
  projection: EmployeeProjection;
  recommendations: RecommendationResult;
}

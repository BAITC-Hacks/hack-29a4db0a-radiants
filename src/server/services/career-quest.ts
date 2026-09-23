import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CompleteActivityResult, EmployeeCard } from "@/contracts/api";
import { enhanceRecommendations } from "@/server/services/recommendation-enhancer";
import { REPEATABLE_EVENT_ID, SNAPSHOT_DATE, type ActivityRecord } from "@/contracts/types";
import { DeterministicEnhancer } from "@/ai/deterministic-enhancer";
import { DeterministicCareerQuestService } from "@/domain/deterministic-service";
import { AppError } from "@/server/errors";
import { getDatabase } from "@/server/db/database";
import {
  ActivityRepository,
  EmployeeRepository,
  EventRepository,
  SkillRepository,
  loadDomainDataset,
  type EmployeeFilters,
} from "@/server/repositories";

const domainService = new DeterministicCareerQuestService();
const recommendationEnhancer = new DeterministicEnhancer();

function employeeInput(employeeId: string, db: Database.Database = getDatabase()) {
  const employee = new EmployeeRepository(db).getById(employeeId);
  if (!employee) throw new AppError(404, "EMPLOYEE_NOT_FOUND", `Employee ${employeeId} was not found`);
  return {
    employee,
    skills: new SkillRepository(db).listSkills(),
    roleProfiles: new SkillRepository(db).listRoleProfiles(),
    events: new EventRepository(db).list(),
    activities: new ActivityRepository(db).listByEmployee(employeeId),
  };
}

export function listEmployees(filters: EmployeeFilters): EmployeeCard[] {
  return new EmployeeRepository().list(filters).map((employee) => ({
    employeeId: employee.employee_id,
    fullName: employee.full_name,
    department: employee.department,
    role: employee.role,
    grade: employee.grade,
    workFormat: employee.work_format,
    preferredLanguage: employee.preferred_language,
    hasCareerGoal: employee.career_goal !== null,
  }));
}

export function getEmployeeProjection(employeeId: string, db: Database.Database = getDatabase()) {
  return domainService.buildEmployeeProjection(employeeInput(employeeId, db));
}

export async function getRecommendations(employeeId: string, db: Database.Database = getDatabase()) {
  const input = employeeInput(employeeId, db);
  const result = domainService.recommend(input);
  return enhanceRecommendations(recommendationEnhancer, result, input);
}

export function getHrSummary(filters: EmployeeFilters, db: Database.Database = getDatabase()) {
  return domainService.buildHrSummary({ dataset: loadDomainDataset(db), filters });
}

export async function completeActivity(
  employeeId: string,
  eventId: string,
  values: { completedAt?: string; score?: number | null; feedbackRating?: number | null },
  db: Database.Database = getDatabase(),
): Promise<CompleteActivityResult> {
  const employees = new EmployeeRepository(db);
  const events = new EventRepository(db);
  const activities = new ActivityRepository(db);
  if (!employees.exists(employeeId)) {
    throw new AppError(404, "EMPLOYEE_NOT_FOUND", `Employee ${employeeId} was not found`);
  }
  const event = events.getById(eventId);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event ${eventId} was not found`);

  let completedAt = values.completedAt;
  if (!completedAt) {
    if (event.format === "self_paced") {
      completedAt = SNAPSHOT_DATE;
    } else {
      completedAt = [...event.upcoming_sessions].filter((date) => date >= SNAPSHOT_DATE).sort()[0];
      if (!completedAt) {
        throw new AppError(
          422,
          "EVENT_NOT_AVAILABLE",
          "A completion date is required because this event has no future session",
        );
      }
    }
  }

  const activity: ActivityRecord = {
    record_id: `LOCAL_${randomUUID()}`,
    employee_id: employeeId,
    event_id: eventId,
    date: completedAt,
    due_date: null,
    status: "completed",
    completion_pct: 100,
    score: values.score ?? null,
    feedback_rating: values.feedbackRating ?? null,
    assigned_by: "self",
  };

  db.transaction(() => {
    if (eventId !== REPEATABLE_EVENT_ID && activities.hasCompleted(employeeId, eventId)) {
      throw new AppError(409, "EVENT_ALREADY_COMPLETED", "This event cannot be completed more than once");
    }
    activities.insert(activity);
  }).immediate();
  return {
    activity,
    projection: getEmployeeProjection(employeeId, db),
    recommendations: await getRecommendations(employeeId, db),
  };
}

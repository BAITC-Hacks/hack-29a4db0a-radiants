import type Database from "better-sqlite3";
import type { ImportResult } from "@/contracts/api";
import type { ActivityRecord, Employee } from "@/contracts/types";
import { parseActivityCsv, parseEmployeeImport, validateCareerDataset, adapterError } from "@/server/data/parsers";
import { adaptStarterDataset } from "@/lib/data/starter-dataset";
import { getDatabase } from "@/server/db/database";
import { AppError } from "@/server/errors";
import {
  ActivityRepository,
  EmployeeRepository,
  EventRepository,
  SkillRepository,
  loadDomainDataset,
} from "@/server/repositories";

export interface ImportPayload {
  employeesJson?: string;
  employeeFileName?: string;
  historyCsv?: string;
  historyFileName?: string;
}

function validateEmployees(employees: Employee[], db: Database.Database, file: string): void {
  const skills = new SkillRepository(db);
  for (const [index, employee] of employees.entries()) {
    if (!skills.hasRoleProfile(employee.role, employee.grade)) {
      throw new AppError(422, "VALIDATION_ERROR", "Employee role/grade profile does not exist", [
        {
          file,
          row: index + 1,
          field: `${employee.employee_id}.role`,
          message: `No role profile for ${employee.role} ${employee.grade}`,
        },
      ]);
    }
    if (
      employee.career_goal &&
      !skills.hasRoleProfile(employee.career_goal.target_role, employee.career_goal.target_grade)
    ) {
      throw new AppError(422, "VALIDATION_ERROR", "Employee career goal is not valid", [
        {
          file,
          row: index + 1,
          field: `${employee.employee_id}.career_goal`,
          message: `No role profile for ${employee.career_goal.target_role} ${employee.career_goal.target_grade}`,
        },
      ]);
    }
  }
}

function validateActivities(
  activities: ActivityRecord[],
  importedEmployeeIds: Set<string>,
  db: Database.Database,
  file: string,
): void {
  const employees = new EmployeeRepository(db);
  const events = new EventRepository(db);
  activities.forEach((activity, index) => {
    if (!importedEmployeeIds.has(activity.employee_id) && !employees.exists(activity.employee_id)) {
      throw new AppError(422, "VALIDATION_ERROR", "History references an unknown employee", [
        {
          file,
          row: index + 2,
          field: "employee_id",
          message: `Unknown employee ${activity.employee_id}`,
        },
      ]);
    }
    if (!events.exists(activity.event_id)) {
      throw new AppError(422, "VALIDATION_ERROR", "History references an unknown event", [
        {
          file,
          row: index + 2,
          field: "event_id",
          message: `Unknown event ${activity.event_id}`,
        },
      ]);
    }
  });
}

export function importData(payload: ImportPayload, db: Database.Database = getDatabase()): ImportResult {
  if (!payload.employeesJson && !payload.historyCsv) {
    throw new AppError(400, "IMPORT_EMPTY", "Provide employees JSON, history CSV, or both");
  }

  const employees = payload.employeesJson
    ? parseEmployeeImport(payload.employeesJson, payload.employeeFileName ?? "employees.json")
    : [];
  const activities = payload.historyCsv
    ? parseActivityCsv(payload.historyCsv, payload.historyFileName ?? "activity_history.csv")
    : [];

  const result: ImportResult = {
    employeesInserted: 0,
    employeesUpdated: 0,
    historyInserted: 0,
    historySkipped: 0,
  };

  db.transaction(() => {
    const existing = loadDomainDataset(db);
    try {
      adaptStarterDataset({
        employeesFile: { employees }, eventsFile: { events: existing.events },
        skillsFile: { skills: existing.skills, role_profiles: existing.roleProfiles }, historyRows: [],
      });
    } catch (error) { throw adapterError(error, payload.employeeFileName ?? "employees.json"); }
    validateEmployees(employees, db, payload.employeeFileName ?? "employees.json");
    validateActivities(activities, new Set(employees.map((employee) => employee.employee_id)), db, payload.historyFileName ?? "activity_history.csv");
    const employeeRepository = new EmployeeRepository(db);
    const activityRepository = new ActivityRepository(db);
    for (const employee of employees) {
      const outcome = employeeRepository.upsert(employee);
      if (outcome === "inserted") result.employeesInserted += 1;
      else result.employeesUpdated += 1;
    }
    for (const activity of activities) {
      if (activityRepository.hasRecord(activity.record_id)) {
        result.historySkipped += 1;
      } else {
        activityRepository.insert(activity);
        result.historyInserted += 1;
      }
    }
    validateCareerDataset(loadDomainDataset(db));
  }).immediate();

  return result;
}

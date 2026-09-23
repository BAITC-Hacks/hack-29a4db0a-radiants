import type Database from "better-sqlite3";
import {
  activitySchema,
  employeeSchema,
  eventSchema,
  roleProfileSchema,
  skillSchema,
} from "@/contracts/schemas";
import type {
  ActivityRecord,
  DevelopmentEvent,
  DomainDataset,
  Employee,
  Grade,
  RoleProfile,
  Skill,
} from "@/contracts/types";
import { getDatabase } from "@/server/db/database";

type EmployeeRow = {
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  grade: Grade;
  manager_id: string | null;
  hire_date: string;
  tenure_months: number;
  work_format: Employee["work_format"];
  preferred_language: Employee["preferred_language"];
  career_goal_json: string | null;
  skills_json: string;
  last_review_date: string;
};

type EventRow = {
  event_id: string;
  title: string;
  description: string;
  type: string;
  format: DevelopmentEvent["format"];
  duration_hours: number;
  mandatory: number;
  target_roles_json: string;
  target_grades_json: string;
  develops_skills_json: string;
  prerequisites_json: string;
  upcoming_sessions_json: string;
};

type ActivityRow = Omit<ActivityRecord, "status" | "assigned_by"> & {
  status: ActivityRecord["status"];
  assigned_by: ActivityRecord["assigned_by"];
};

function decodeEmployee(row: EmployeeRow): Employee {
  return employeeSchema.parse({
    employee_id: row.employee_id,
    full_name: row.full_name,
    department: row.department,
    role: row.role,
    grade: row.grade,
    manager_id: row.manager_id,
    hire_date: row.hire_date,
    tenure_months: row.tenure_months,
    work_format: row.work_format,
    preferred_language: row.preferred_language,
    career_goal: row.career_goal_json ? JSON.parse(row.career_goal_json) : null,
    skills: JSON.parse(row.skills_json),
    last_review_date: row.last_review_date,
  });
}

function decodeEvent(row: EventRow): DevelopmentEvent {
  return eventSchema.parse({
    event_id: row.event_id,
    title: row.title,
    description: row.description,
    type: row.type,
    format: row.format,
    duration_hours: row.duration_hours,
    mandatory: Boolean(row.mandatory),
    target_roles: JSON.parse(row.target_roles_json),
    target_grades: JSON.parse(row.target_grades_json),
    develops_skills: JSON.parse(row.develops_skills_json),
    prerequisites: JSON.parse(row.prerequisites_json),
    upcoming_sessions: JSON.parse(row.upcoming_sessions_json),
  });
}

function decodeActivity(row: ActivityRow): ActivityRecord {
  return activitySchema.parse(row);
}

export interface EmployeeFilters {
  search?: string;
  role?: string;
  grade?: Grade;
  department?: string;
}

export class EmployeeRepository {
  constructor(private readonly db: Database.Database = getDatabase()) {}

  list(filters: EmployeeFilters = {}): Employee[] {
    const clauses: string[] = [];
    const values: Record<string, string> = {};
    if (filters.search) {
      clauses.push("(LOWER(full_name) LIKE @search OR LOWER(employee_id) LIKE @search)");
      values.search = `%${filters.search.toLowerCase()}%`;
    }
    if (filters.role) {
      clauses.push("role = @role");
      values.role = filters.role;
    }
    if (filters.grade) {
      clauses.push("grade = @grade");
      values.grade = filters.grade;
    }
    if (filters.department) {
      clauses.push("department = @department");
      values.department = filters.department;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM employees ${where} ORDER BY full_name, employee_id`)
      .all(values) as EmployeeRow[];
    return rows.map(decodeEmployee);
  }

  getById(employeeId: string): Employee | null {
    const row = this.db.prepare("SELECT * FROM employees WHERE employee_id = ?").get(employeeId) as
      | EmployeeRow
      | undefined;
    return row ? decodeEmployee(row) : null;
  }

  exists(employeeId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM employees WHERE employee_id = ?").get(employeeId));
  }

  upsert(employee: Employee): "inserted" | "updated" {
    const existed = this.exists(employee.employee_id);
    this.db
      .prepare(`
        INSERT INTO employees(
          employee_id, full_name, department, role, grade, manager_id, hire_date,
          tenure_months, work_format, preferred_language, career_goal_json, skills_json,
          last_review_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_id) DO UPDATE SET
          full_name = excluded.full_name,
          department = excluded.department,
          role = excluded.role,
          grade = excluded.grade,
          manager_id = excluded.manager_id,
          hire_date = excluded.hire_date,
          tenure_months = excluded.tenure_months,
          work_format = excluded.work_format,
          preferred_language = excluded.preferred_language,
          career_goal_json = excluded.career_goal_json,
          skills_json = excluded.skills_json,
          last_review_date = excluded.last_review_date
      `)
      .run(
        employee.employee_id,
        employee.full_name,
        employee.department,
        employee.role,
        employee.grade,
        employee.manager_id,
        employee.hire_date,
        employee.tenure_months,
        employee.work_format,
        employee.preferred_language,
        employee.career_goal ? JSON.stringify(employee.career_goal) : null,
        JSON.stringify(employee.skills),
        employee.last_review_date,
      );
    return existed ? "updated" : "inserted";
  }
}

export class EventRepository {
  constructor(private readonly db: Database.Database = getDatabase()) {}

  list(): DevelopmentEvent[] {
    return (this.db.prepare("SELECT * FROM events ORDER BY event_id").all() as EventRow[]).map(
      decodeEvent,
    );
  }

  getById(eventId: string): DevelopmentEvent | null {
    const row = this.db.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId) as
      | EventRow
      | undefined;
    return row ? decodeEvent(row) : null;
  }

  exists(eventId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(eventId));
  }
}

export class SkillRepository {
  constructor(private readonly db: Database.Database = getDatabase()) {}

  listSkills(): Skill[] {
    const rows = this.db.prepare("SELECT * FROM skills ORDER BY skill_id").all() as Skill[];
    return rows.map((row) => skillSchema.parse(row));
  }

  listRoleProfiles(): RoleProfile[] {
    const rows = this.db.prepare("SELECT * FROM role_profiles ORDER BY role, grade").all() as Array<{
      role: string;
      grade: Grade;
      required_skills_json: string;
      critical_skills_json: string;
    }>;
    return rows.map((row) =>
      roleProfileSchema.parse({
        role: row.role,
        grade: row.grade,
        required_skills: JSON.parse(row.required_skills_json),
        critical_skills: JSON.parse(row.critical_skills_json),
      }),
    );
  }

  hasRoleProfile(role: string, grade: Grade): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM role_profiles WHERE role = ? AND grade = ?").get(role, grade),
    );
  }
}

export class ActivityRepository {
  constructor(private readonly db: Database.Database = getDatabase()) {}

  listAll(): ActivityRecord[] {
    return (
      this.db.prepare("SELECT * FROM activity_history ORDER BY date, employee_id, event_id").all() as ActivityRow[]
    ).map(decodeActivity);
  }

  listByEmployee(employeeId: string): ActivityRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM activity_history WHERE employee_id = ? ORDER BY date, record_id")
        .all(employeeId) as ActivityRow[]
    ).map(decodeActivity);
  }

  hasRecord(recordId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM activity_history WHERE record_id = ?").get(recordId));
  }

  hasCompleted(employeeId: string, eventId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM activity_history WHERE employee_id = ? AND event_id = ? AND status = 'completed' LIMIT 1",
        )
        .get(employeeId, eventId),
    );
  }

  insert(activity: ActivityRecord): void {
    this.db
      .prepare(`
        INSERT INTO activity_history(
          record_id, employee_id, event_id, date, due_date, status, completion_pct,
          score, feedback_rating, assigned_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        activity.record_id,
        activity.employee_id,
        activity.event_id,
        activity.date,
        activity.due_date,
        activity.status,
        activity.completion_pct,
        activity.score,
        activity.feedback_rating,
        activity.assigned_by,
      );
  }
}

export function loadDomainDataset(db: Database.Database = getDatabase()): DomainDataset {
  return {
    skills: new SkillRepository(db).listSkills(),
    roleProfiles: new SkillRepository(db).listRoleProfiles(),
    employees: new EmployeeRepository(db).list(),
    events: new EventRepository(db).list(),
    activities: new ActivityRepository(db).listAll(),
  };
}

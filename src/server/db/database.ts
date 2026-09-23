import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { parseStarterFiles } from "@/server/data/parsers";
import { AppError } from "@/server/errors";

export const SCHEMA_VERSION = 1;

const EXPECTED_STARTER_COUNTS = {
  skills: 60,
  role_profiles: 32,
  employees: 200,
  events: 40,
  activity_history: 2743,
} as const;

declare global {
  // eslint-disable-next-line no-var
  var __careerQuestDb: Database.Database | undefined;
}

function databasePath(): string {
  return process.env.CAREER_QUEST_DB_PATH ?? path.join(process.cwd(), ".data", "career-quest.sqlite");
}

function dataDirectory(): string {
  return process.env.CAREER_QUEST_DATA_DIR ?? path.join(process.cwd(), "data");
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      skill_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_profiles (
      role TEXT NOT NULL,
      grade TEXT NOT NULL,
      required_skills_json TEXT NOT NULL,
      critical_skills_json TEXT NOT NULL,
      PRIMARY KEY (role, grade)
    );

    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      department TEXT NOT NULL,
      role TEXT NOT NULL,
      grade TEXT NOT NULL,
      manager_id TEXT,
      hire_date TEXT NOT NULL,
      tenure_months INTEGER NOT NULL,
      work_format TEXT NOT NULL,
      preferred_language TEXT NOT NULL,
      career_goal_json TEXT,
      skills_json TEXT NOT NULL,
      last_review_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      duration_hours REAL NOT NULL,
      mandatory INTEGER NOT NULL,
      target_roles_json TEXT NOT NULL,
      target_grades_json TEXT NOT NULL,
      develops_skills_json TEXT NOT NULL,
      prerequisites_json TEXT NOT NULL,
      upcoming_sessions_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_history (
      record_id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(employee_id),
      event_id TEXT NOT NULL REFERENCES events(event_id),
      date TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      completion_pct INTEGER NOT NULL,
      score INTEGER,
      feedback_rating INTEGER,
      assigned_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);
    CREATE INDEX IF NOT EXISTS idx_employees_grade ON employees(grade);
    CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
    CREATE INDEX IF NOT EXISTS idx_activity_employee ON activity_history(employee_id);
    CREATE INDEX IF NOT EXISTS idx_activity_event ON activity_history(event_id);
    CREATE INDEX IF NOT EXISTS idx_activity_status ON activity_history(status);
    CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_history(date);
  `);

  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
  ).run(SCHEMA_VERSION, new Date().toISOString());
}

function readStarterFile(name: string): string {
  const filePath = path.join(/* turbopackIgnore: true */ dataDirectory(), name);
  if (!fs.existsSync(/* turbopackIgnore: true */ filePath)) {
    throw new AppError(500, "STARTER_DATA_MISSING", `Starter file is missing: ${name}`);
  }
  return fs.readFileSync(/* turbopackIgnore: true */ filePath, "utf8");
}

function seedStarterData(db: Database.Database): void {
  const alreadySeeded = Object.entries(EXPECTED_STARTER_COUNTS).every(([table, minimum]) => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count >= minimum;
  });
  if (alreadySeeded) return;
  const parsed = parseStarterFiles({
    skills: readStarterFile("skills.json"),
    employees: readStarterFile("employees.json"),
    events: readStarterFile("events.json"),
    history: readStarterFile("activity_history.csv"),
  });

  const insertSkill = db.prepare(`
    INSERT OR IGNORE INTO skills(skill_id, name, type, category, description)
    VALUES (@skill_id, @name, @type, @category, @description)
  `);
  const insertRoleProfile = db.prepare(`
    INSERT OR IGNORE INTO role_profiles(role, grade, required_skills_json, critical_skills_json)
    VALUES (?, ?, ?, ?)
  `);
  const insertEmployee = db.prepare(`
    INSERT OR IGNORE INTO employees(
      employee_id, full_name, department, role, grade, manager_id, hire_date,
      tenure_months, work_format, preferred_language, career_goal_json, skills_json,
      last_review_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events(
      event_id, title, description, type, format, duration_hours, mandatory,
      target_roles_json, target_grades_json, develops_skills_json,
      prerequisites_json, upcoming_sessions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertActivity = db.prepare(`
    INSERT OR IGNORE INTO activity_history(
      record_id, employee_id, event_id, date, due_date, status, completion_pct,
      score, feedback_rating, assigned_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const skill of parsed.skills.skills) insertSkill.run(skill);
    for (const profile of parsed.skills.role_profiles) {
      insertRoleProfile.run(
        profile.role,
        profile.grade,
        JSON.stringify(profile.required_skills),
        JSON.stringify(profile.critical_skills),
      );
    }
    for (const employee of parsed.employees.employees) {
      insertEmployee.run(
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
    }
    for (const event of parsed.events.events) {
      insertEvent.run(
        event.event_id,
        event.title,
        event.description,
        event.type,
        event.format,
        event.duration_hours,
        event.mandatory ? 1 : 0,
        JSON.stringify(event.target_roles),
        JSON.stringify(event.target_grades),
        JSON.stringify(event.develops_skills),
        JSON.stringify(event.prerequisites),
        JSON.stringify(event.upcoming_sessions),
      );
    }
    for (const activity of parsed.activities) {
      insertActivity.run(
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
    verifyStarterData(db);
  }).immediate();
}

function verifyStarterData(db: Database.Database): void {
  for (const [table, minimum] of Object.entries(EXPECTED_STARTER_COUNTS)) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    if (row.count < minimum) {
      throw new AppError(
        500,
        "STARTER_DATA_INCOMPLETE",
        `Expected at least ${minimum} rows in ${table}, found ${row.count}`,
      );
    }
  }
}

export function getDatabase(): Database.Database {
  if (globalThis.__careerQuestDb?.open) return globalThis.__careerQuestDb;

  const filePath = databasePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  try {
    db.transaction(() => applyMigrations(db)).immediate();
    seedStarterData(db);
    verifyStarterData(db);
  } catch (error) {
    db.close();
    throw error;
  }

  globalThis.__careerQuestDb = db;
  return db;
}

export function closeDatabase(): void {
  if (globalThis.__careerQuestDb?.open) globalThis.__careerQuestDb.close();
  globalThis.__careerQuestDb = undefined;
}

export function databaseCounts(db = getDatabase()) {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    skills: count("skills"),
    roleProfiles: count("role_profiles"),
    employees: count("employees"),
    events: count("events"),
    activityHistory: count("activity_history"),
  };
}

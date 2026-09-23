import { GRADES, type ActivityRecord, type CareerDataset, type DevelopmentEvent, type Employee, type RoleProfile, type Skill, type SkillLevel } from "../../types/career";
import { roleProfileKey } from "./normalize";

export interface StarterDatasetInput {
  employeesFile: unknown;
  eventsFile: unknown;
  skillsFile: unknown;
  historyRows: unknown;
}

/** Accepts decoded JSON and parsed CSV rows; never reads files or merges demo state. */
export function adaptStarterDataset(input: StarterDatasetInput): CareerDataset {
  const employees = object(input.employeesFile, "employees.json");
  const events = object(input.eventsFile, "events.json");
  const skills = object(input.skillsFile, "skills.json");
  const dataset: CareerDataset = {
    employees: list(employees.employees, "employees.json.employees", parseEmployee),
    events: list(events.events, "events.json.events", parseEvent),
    skills: list(skills.skills, "skills.json.skills", parseSkill),
    roleProfiles: list(skills.role_profiles, "skills.json.role_profiles", parseRoleProfile),
    history: parseActivityHistoryRows(input.historyRows),
  };
  validateReferences(dataset);
  return dataset;
}

/** Also usable for extra history imports; reference validation needs the complete dataset. */
export function parseActivityHistoryRows(rows: unknown): ActivityRecord[] {
  const history = list(rows, "historyRows", (value, path): ActivityRecord => {
    const row = object(value, path);
    return {
      record_id: string(row.record_id, `${path}.record_id`),
      employee_id: string(row.employee_id, `${path}.employee_id`),
      event_id: string(row.event_id, `${path}.event_id`),
      date: date(row.date, `${path}.date`),
      due_date: empty(row.due_date) ? null : date(row.due_date, `${path}.due_date`),
      status: choice(row.status, ["completed", "in_progress", "dropped", "no_show", "declined", "overdue"], `${path}.status`),
      completion_pct: csvNumber(row.completion_pct, `${path}.completion_pct`, 0, 100),
      score: empty(row.score) ? null : csvNumber(row.score, `${path}.score`, 0, 100),
      feedback_rating: empty(row.feedback_rating) ? null : csvNumber(row.feedback_rating, `${path}.feedback_rating`, 1, 5),
      assigned_by: choice(row.assigned_by, ["self", "manager", "hr"], `${path}.assigned_by`),
    };
  });
  unique(history, (row) => row.record_id, "historyRows");
  return history;
}

function parseEmployee(value: unknown, path: string): Employee {
  const row = object(value, path);
  const goal = row.career_goal == null ? null : object(row.career_goal, `${path}.career_goal`);
  return {
    employee_id: string(row.employee_id, `${path}.employee_id`),
    full_name: string(row.full_name, `${path}.full_name`),
    department: string(row.department, `${path}.department`),
    role: string(row.role, `${path}.role`),
    grade: choice(row.grade, GRADES, `${path}.grade`),
    manager_id: row.manager_id == null ? null : string(row.manager_id, `${path}.manager_id`),
    hire_date: date(row.hire_date, `${path}.hire_date`),
    tenure_months: number(row.tenure_months, `${path}.tenure_months`, 0, Number.MAX_SAFE_INTEGER),
    work_format: choice(row.work_format, ["office", "hybrid", "remote"], `${path}.work_format`),
    preferred_language: choice(row.preferred_language, ["kk", "ru", "en"], `${path}.preferred_language`),
    career_goal: goal ? {
      target_role: string(goal.target_role, `${path}.career_goal.target_role`),
      target_grade: choice(goal.target_grade, GRADES, `${path}.career_goal.target_grade`),
    } : null,
    skills: levels(row.skills, `${path}.skills`),
    last_review_date: date(row.last_review_date, `${path}.last_review_date`),
  };
}

function parseEvent(value: unknown, path: string): DevelopmentEvent {
  const row = object(value, path);
  if (typeof row.mandatory !== "boolean") fail(`${path}.mandatory`, "expected a boolean");
  return {
    event_id: string(row.event_id, `${path}.event_id`),
    title: string(row.title, `${path}.title`),
    description: string(row.description, `${path}.description`, true),
    type: choice(row.type, ["compliance", "onboarding", "course", "workshop", "mentoring", "certification", "meetup"], `${path}.type`),
    format: choice(row.format, ["online", "offline", "self_paced"], `${path}.format`),
    duration_hours: number(row.duration_hours, `${path}.duration_hours`, 0, Number.MAX_SAFE_INTEGER, false),
    mandatory: row.mandatory,
    target_roles: list(row.target_roles, `${path}.target_roles`, string),
    target_grades: list(row.target_grades, `${path}.target_grades`, (grade, at) => choice(grade, GRADES, at)),
    develops_skills: list(row.develops_skills, `${path}.develops_skills`, (value, at) => {
      const effect = object(value, at);
      return {
        skill_id: string(effect.skill_id, `${at}.skill_id`),
        gain: number(effect.gain, `${at}.gain`, 0, 5),
        max_level: skillLevel(effect.max_level, `${at}.max_level`),
      };
    }),
    prerequisites: levels(row.prerequisites, `${path}.prerequisites`),
    upcoming_sessions: list(row.upcoming_sessions, `${path}.upcoming_sessions`, date),
  };
}

function parseSkill(value: unknown, path: string): Skill {
  const row = object(value, path);
  return {
    skill_id: string(row.skill_id, `${path}.skill_id`),
    name: string(row.name, `${path}.name`),
    type: choice(row.type, ["hard", "soft"], `${path}.type`),
    category: string(row.category, `${path}.category`),
    description: string(row.description, `${path}.description`, true),
  };
}

function parseRoleProfile(value: unknown, path: string): RoleProfile {
  const row = object(value, path);
  return {
    role: string(row.role, `${path}.role`),
    grade: choice(row.grade, GRADES, `${path}.grade`),
    required_skills: levels(row.required_skills, `${path}.required_skills`),
    critical_skills: list(row.critical_skills, `${path}.critical_skills`, string),
  };
}

function validateReferences(dataset: CareerDataset): void {
  const employees = unique(dataset.employees, (row) => row.employee_id, "employees.json.employees");
  const events = unique(dataset.events, (row) => row.event_id, "events.json.events");
  const skills = unique(dataset.skills, (row) => row.skill_id, "skills.json.skills");
  const profiles = unique(dataset.roleProfiles, (row) => roleProfileKey(row.role, row.grade), "skills.json.role_profiles");
  const requireSkill = (id: string, path: string) => {
    if (!skills.has(id)) fail(path, `unknown skill ID ${id}`);
  };
  dataset.employees.forEach((employee, index) => {
    const path = `employees.json.employees[${index}]`;
    Object.keys(employee.skills).forEach((id) => requireSkill(id, `${path}.skills`));
    const grade = employee.career_goal?.target_grade ?? GRADES[GRADES.indexOf(employee.grade) + 1];
    const role = employee.career_goal?.target_role ?? employee.role;
    if (grade && !profiles.has(roleProfileKey(role, grade))) fail(path, `missing target role profile ${role} ${grade}`);
  });
  dataset.events.forEach((event, index) => {
    const path = `events.json.events[${index}]`;
    unique(event.develops_skills, (effect) => effect.skill_id, `${path}.develops_skills`);
    event.develops_skills.forEach((effect) => requireSkill(effect.skill_id, `${path}.develops_skills`));
    Object.keys(event.prerequisites).forEach((id) => requireSkill(id, `${path}.prerequisites`));
  });
  dataset.roleProfiles.forEach((profile, index) => {
    const path = `skills.json.role_profiles[${index}]`;
    Object.keys(profile.required_skills).forEach((id) => requireSkill(id, `${path}.required_skills`));
    profile.critical_skills.forEach((id) => {
      if (!Object.hasOwn(profile.required_skills, id)) fail(`${path}.critical_skills`, `skill ${id} has no requirement`);
    });
  });
  dataset.history.forEach((record, index) => {
    if (!employees.has(record.employee_id)) fail(`historyRows[${index}].employee_id`, "unknown employee ID");
    if (!events.has(record.event_id)) fail(`historyRows[${index}].event_id`, "unknown event ID");
  });
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}

function list<T>(value: unknown, path: string, parse: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value.map((item: unknown, index: number) => parse(item, `${path}[${index}]`));
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) fail(path, "expected a non-empty string");
  return value.trim();
}

function number(value: unknown, path: string, min: number, max: number, integer = true): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(path, `expected ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  }
  return value;
}

function csvNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) fail(path, "expected a numeric CSV value");
    return number(Number(trimmed), path, min, max);
  }
  return number(value, path, min, max);
}

function empty(value: unknown): boolean {
  return value == null || (typeof value === "string" && !value.trim());
}

function choice<const T extends readonly string[]>(value: unknown, options: T, path: string): T[number] {
  const result = string(value, path);
  if (!options.includes(result)) fail(path, `expected one of ${options.join(", ")}`);
  return result;
}

function date(value: unknown, path: string): string {
  const result = string(value, path);
  const timestamp = Date.parse(result);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== result) {
    fail(path, "expected a valid YYYY-MM-DD date");
  }
  return result;
}

function skillLevel(value: unknown, path: string): SkillLevel {
  return number(value, path, 0, 5) as SkillLevel;
}

function levels(value: unknown, path: string): Record<string, SkillLevel> {
  const entries = Object.entries(object(value, path)).map(([id, level]) => [
    string(id, path), skillLevel(level, `${path}.${id}`),
  ]);
  return Object.fromEntries(entries);
}

function unique<T>(rows: T[], key: (row: T) => string, path: string): Set<string> {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const id = key(row);
    if (seen.has(id)) fail(`${path}[${index}]`, `duplicate ID ${id}`);
    seen.add(id);
  });
  return seen;
}

import { normalizeDataset } from "../data/normalize";
import type { CareerDataset } from "../../types/career";
import { demoDataset } from "./demo-data";

const STORAGE_KEY = "career-quest-demo-dataset-v1";

export function loadDataset(): CareerDataset {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeDataset(JSON.parse(stored) as CareerDataset);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return normalizeDataset(structuredClone(demoDataset));
}

export function saveDataset(dataset: CareerDataset): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    employees: dataset.employees,
    events: dataset.events,
    skills: dataset.skills,
    roleProfiles: dataset.roleProfiles,
    history: dataset.history,
  }));
}

export function parseImportText(text: string, fileName: string, current: CareerDataset): CareerDataset {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The selected file is empty.");
  if (fileName.toLowerCase().endsWith(".csv")) {
    const rows = parseCsv(trimmed);
    if (!rows.length) throw new Error("The CSV has no data rows.");
    const isHistory = ["record_id", "event_id", "status"].every((key) => key in rows[0]!);
    if (isHistory) {
      return { ...current, history: mergeById(current.history, rows.map((row, index) => ({
        record_id: row.record_id || `IMPORT-${Date.now()}-${index}`,
        employee_id: required(row, "employee_id"), event_id: required(row, "event_id"), date: required(row, "date"),
        due_date: row.due_date || null, status: required(row, "status") as CareerDataset["history"][number]["status"],
        completion_pct: Number(row.completion_pct || 0), score: row.score ? Number(row.score) : null,
        feedback_rating: row.feedback_rating ? Number(row.feedback_rating) : null,
        assigned_by: (row.assigned_by || "self") as CareerDataset["history"][number]["assigned_by"],
      }))) };
    }
    if (rows[0]!.employee_id && rows[0]!.role && rows[0]!.grade) {
      const employees = rows.map((row) => ({
        employee_id: required(row, "employee_id"), full_name: required(row, "full_name"),
        department: row.department ?? "", role: required(row, "role"), grade: required(row, "grade") as CareerDataset["employees"][number]["grade"],
        manager_id: row.manager_id || null, hire_date: row.hire_date ?? "", tenure_months: Number(row.tenure_months || 0),
        work_format: (row.work_format || "hybrid") as CareerDataset["employees"][number]["work_format"],
        preferred_language: (row.preferred_language || "en") as CareerDataset["employees"][number]["preferred_language"],
        career_goal: row.career_goal ? JSON.parse(row.career_goal) as CareerDataset["employees"][number]["career_goal"] : null,
        skills: row.skills ? JSON.parse(row.skills) as CareerDataset["employees"][number]["skills"] : {},
        last_review_date: row.last_review_date || "2026-10-01",
      }));
      validateEmployeeRecords(employees);
      const next = { ...current, employees: mergeById(current.employees, employees) };
      validateEmployeeTargets(next);
      return next;
    }
    throw new Error("CSV must contain employee_id, role and grade columns, or activity_history columns.");
  }
  const parsed: unknown = JSON.parse(trimmed);
  const incoming = Array.isArray(parsed)
    ? (parsed[0] && typeof parsed[0] === "object" && "event_id" in parsed[0] ? { history: parsed } : { employees: parsed })
    : parsed as Record<string, unknown>;
  if (!incoming || typeof incoming !== "object" || (!Array.isArray(incoming.employees) && !Array.isArray(incoming.history))) {
    throw new Error("Expected an employee array, activity-history array, or dataset object with employees/history arrays.");
  }
  const employees = Array.isArray(incoming.employees) ? incoming.employees as CareerDataset["employees"] : [];
  validateEmployeeRecords(employees);
  const history = Array.isArray(incoming.history) ? incoming.history as CareerDataset["history"] : [];
  const isComplete = ["events", "skills", "roleProfiles", "employees"].every((key) => Array.isArray(incoming[key]));
  const next: CareerDataset = {
    employees: isComplete ? employees : mergeById(current.employees, employees),
    history: isComplete ? history : mergeById(current.history, history),
    events: Array.isArray(incoming.events) ? mergeById(current.events, incoming.events as CareerDataset["events"]) : current.events,
    skills: Array.isArray(incoming.skills) ? mergeById(current.skills, incoming.skills as CareerDataset["skills"]) : current.skills,
    roleProfiles: Array.isArray(incoming.roleProfiles) ? mergeById(current.roleProfiles, incoming.roleProfiles as CareerDataset["roleProfiles"]) : current.roleProfiles,
  };
  normalizeDataset(next);
  validateEmployeeTargets(next);
  return next;
}

function validateEmployeeTargets(dataset: CareerDataset): void {
  const normalized = normalizeDataset(dataset);
  for (const employee of normalized.employees) {
    const target = employee.career_goal ?? (() => {
      const grades = ["Junior", "Middle", "Senior", "Lead"];
      const nextGrade = grades[grades.indexOf(employee.grade) + 1];
      return nextGrade ? { target_role: employee.role, target_grade: nextGrade } : null;
    })();
    if (target && !normalized.roleProfileByKey.has(`${target.target_role}::${target.target_grade}`)) {
      throw new Error(`No role requirements found for ${employee.full_name}'s target ${target.target_role} ${target.target_grade}. Include the matching role profile in the import.`);
    }
  }
}

function validateEmployeeRecords(employees: CareerDataset["employees"]): void {
  const grades = ["Junior", "Middle", "Senior", "Lead"];
  for (const employee of employees) {
    if (!employee || typeof employee !== "object") {
      throw new Error("Each employee record must be a JSON object.");
    }
    const row = employee as unknown as Record<string, unknown>;
    if (
      typeof row.employee_id !== "string" || !row.employee_id ||
      typeof row.full_name !== "string" || !row.full_name ||
      typeof row.role !== "string" || !row.role ||
      typeof row.department !== "string" ||
      !grades.includes(String(row.grade)) ||
      typeof row.skills !== "object" || row.skills === null || Array.isArray(row.skills)
    ) {
      throw new Error("Each employee needs employee_id, full_name, department, role, a valid grade, and a skills object.");
    }
    for (const [skill, level] of Object.entries(row.skills as Record<string, unknown>)) {
      if (!skill || typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 5) {
        throw new Error(`Employee ${row.employee_id} has an invalid skill level for ${skill}. Levels must be integers from 0 to 5.`);
      }
    }
  }
}

function mergeById<T>(existing: T[], additions: T[]): T[] {
  const key = (row: T) => {
    const value = row as Record<string, unknown>;
    return value.record_id ?? value.employee_id ?? value.event_id ?? value.skill_id ?? `${value.role}::${value.grade}`;
  };
  const ids = new Set(additions.map(key));
  return [...existing.filter((row) => !ids.has(key(row))), ...additions];
}

function required(row: Record<string, string>, key: string): string {
  if (!row[key]) throw new Error(`Missing required CSV column value: ${key}`);
  return row[key]!;
}

function parseCsv(source: string): Array<Record<string, string>> {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const split = (line: string) => {
    const fields: string[] = []; let value = ""; let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index]!;
      if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { fields.push(value); value = ""; }
      else value += char;
    }
    fields.push(value); return fields;
  };
  const headers = split(lines[0]!).map((header) => header.trim());
  if (headers.length < 3) throw new Error("CSV headers could not be read.");
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, (split(line)[index] ?? "").trim()])));
}

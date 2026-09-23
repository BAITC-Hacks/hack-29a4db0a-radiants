import { parse } from "csv-parse/sync";
import { ZodError } from "zod";
import {
  activitySchema,
  employeeSchema,
  employeesFileSchema,
  eventsFileSchema,
  skillsFileSchema,
} from "@/contracts/schemas";
import type { ActivityRecord, Employee } from "@/contracts/types";
import { AppError, zodDetails } from "@/server/errors";

function parseInteger(value: string, field: string, row: number, file: string): number {
  const parsed = Number(value);
  if (typeof value !== "string" || !/^-?\d+$/.test(value) || !Number.isInteger(parsed)) {
    throw new AppError(422, "VALIDATION_ERROR", `Invalid integer in ${field}`, [
      { file, row, field, message: `Expected integer, received ${value}` },
    ]);
  }
  return parsed;
}

function parseNullableInteger(value: string, field: string, row: number, file: string): number | null {
  return value === "" ? null : parseInteger(value, field, row, file);
}

export function parseActivityCsv(source: string, file = "activity_history.csv"): ActivityRecord[] {
  let rows: Record<string, string>[];
  try {
    rows = parse(source, {
      columns: (headers: string[]) => {
        const required = ["record_id", "employee_id", "event_id", "date", "due_date", "status", "completion_pct", "score", "feedback_rating", "assigned_by"];
        const missing = required.filter((column) => !headers.includes(column));
        if (missing.length || new Set(headers).size !== headers.length) {
          throw new AppError(422, "VALIDATION_ERROR", "Invalid history CSV header", [
            { file, row: 1, field: missing[0] ?? "header", message: missing.length ? `Missing columns: ${missing.join(", ")}` : "Duplicate column names" },
          ]);
        }
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "VALIDATION_ERROR", "CSV could not be parsed", [
      { file, message: error instanceof Error ? error.message : "Invalid CSV" },
    ]);
  }

  return rows.map((row, index) => {
    const line = index + 2;
    try {
      return activitySchema.parse({
        record_id: row.record_id,
        employee_id: row.employee_id,
        event_id: row.event_id,
        date: row.date,
        due_date: row.due_date || null,
        status: row.status,
        completion_pct: parseInteger(row.completion_pct, "completion_pct", line, file),
        score: parseNullableInteger(row.score, "score", line, file),
        feedback_rating: parseNullableInteger(row.feedback_rating, "feedback_rating", line, file),
        assigned_by: row.assigned_by,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof ZodError) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          `Invalid activity record at line ${line}`,
          zodDetails(error, file).map((detail) => ({ ...detail, row: line })),
        );
      }
      throw error;
    }
  });
}

export function parseEmployeeImport(source: string, file = "employees.json"): Employee[] {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (error) {
    throw new AppError(422, "VALIDATION_ERROR", "Employee JSON could not be parsed", [
      { file, message: error instanceof Error ? error.message : "Invalid JSON" },
    ]);
  }

  const entries: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object" && "employees" in json && Array.isArray(json.employees)
      ? json.employees
      : [json];
  return entries.map((entry, index) => {
    const parsed = employeeSchema.safeParse(entry);
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Employee JSON failed validation", zodDetails(parsed.error, file).map((detail) => ({ ...detail, row: index + 1 })));
    }
    return parsed.data;
  });
}

export function parseStarterFiles(input: {
  skills: string;
  employees: string;
  events: string;
  history: string;
}) {
  try {
    const skills = skillsFileSchema.parse(JSON.parse(input.skills));
    const employees = employeesFileSchema.parse(JSON.parse(input.employees));
    const events = eventsFileSchema.parse(JSON.parse(input.events));
    const activities = parseActivityCsv(input.history);
    return { skills, employees, events, activities };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof ZodError) {
      throw new AppError(500, "STARTER_DATA_INVALID", "Starter dataset failed validation", zodDetails(error));
    }
    throw new AppError(500, "STARTER_DATA_INVALID", "Starter dataset could not be loaded", [
      { message: error instanceof Error ? error.message : "Unknown starter data error" },
    ]);
  }
}

import { parse } from "csv-parse/sync";
import { ZodError } from "zod";
import { employeeSchema } from "@/contracts/schemas";
import type { ActivityRecord, CareerDataset, Employee } from "@/types/career";
import { adaptStarterDataset, parseActivityHistoryRows } from "@/lib/data/starter-dataset";
import { AppError, zodDetails } from "@/server/errors";

export function adapterError(error: unknown, file?: string, row?: number): AppError {
  const message = error instanceof Error ? error.message : "Invalid dataset";
  const location = message.split(":")[0];
  const index = location.match(/\[(\d+)\]/);
  const inferredFile = location.startsWith("historyRows") ? "activity_history.csv" : location.split(".json")[0] + ".json";
  const field = location.replace(/^.*?\[\d+\]\.?/, "") || "record";
  return new AppError(422, "VALIDATION_ERROR", "Dataset validation failed", [{
    file: file ?? inferredFile,
    row: row ?? (index ? Number(index[1]) + (location.startsWith("historyRows") ? 2 : 1) : undefined),
    field,
    message,
  }]);
}

export function parseActivityCsv(source: string, file = "activity_history.csv"): ActivityRecord[] {
  try {
    const rows = parse(source, {
      columns: (headers: string[]) => {
        const required = ["record_id", "employee_id", "event_id", "date", "status", "completion_pct", "assigned_by"];
        const missing = required.filter((field) => !headers.includes(field));
        if (missing.length || new Set(headers).size !== headers.length) {
          throw new AppError(422, "VALIDATION_ERROR", "Invalid CSV header", [{
            file, row: 1, field: missing[0] ?? "header",
            message: missing.length ? "Missing required columns: " + missing.join(", ") : "Duplicate column names",
          }]);
        }
        return headers;
      }, skip_empty_lines: true, trim: true, bom: true, info: true,
    }) as Array<{ record: Record<string, string>; info: { lines: number } }>;
    // Validate each row through the shared adapter. Repository import handles repeated IDs.
    return rows.map(({ record, info }) => {
      try { return parseActivityHistoryRows([record])[0]; }
      catch (error) { throw adapterError(error, file, info.lines); }
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw adapterError(error, file);
  }
}

export function parseEmployeeImport(source: string, file = "employees.json"): Employee[] {
  let json: unknown;
  try { json = JSON.parse(source); }
  catch (error) { throw adapterError(error, file); }
  const entries: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object" && "employees" in json && Array.isArray(json.employees)
      ? json.employees : [json];
  return entries.map((entry, index) => {
    const parsed = employeeSchema.safeParse(entry);
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Employee JSON failed validation",
        zodDetails(parsed.error, file).map((detail) => ({ ...detail, row: index + 1 })));
    }
    return parsed.data;
  });
}

export function validateCareerDataset(dataset: CareerDataset): CareerDataset {
  try {
    return adaptStarterDataset({
      employeesFile: { employees: dataset.employees },
      eventsFile: { events: dataset.events },
      skillsFile: { skills: dataset.skills, role_profiles: dataset.roleProfiles },
      historyRows: dataset.history,
    });
  } catch (error) { throw adapterError(error); }
}

export function parseStarterFiles(input: { skills: string; employees: string; events: string; history: string }) {
  try {
    const dataset = adaptStarterDataset({
      skillsFile: JSON.parse(input.skills),
      employeesFile: JSON.parse(input.employees),
      eventsFile: JSON.parse(input.events),
      historyRows: parse(input.history, { columns: true, skip_empty_lines: true, trim: true, bom: true }),
    });
    return {
      skills: { skills: dataset.skills, role_profiles: dataset.roleProfiles },
      employees: { employees: dataset.employees },
      events: { events: dataset.events },
      activities: dataset.history,
    };
  } catch (error) {
    const details = error instanceof ZodError ? zodDetails(error) : adapterError(error).details;
    throw new AppError(500, "STARTER_DATA_INVALID", "Starter dataset failed validation", details);
  }
}

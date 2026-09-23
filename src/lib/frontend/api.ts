import type { Employee, EmployeeView } from "../../types/career";
import type { HrSummary } from "../analytics/hr-summary";
import { isEmployeeList, isEmployeeView, isHrSummary, isImportResult } from "./response-validation";

/** Optional transport fields. Domain HrSummary and EmployeeView remain unchanged. */
export type HrSummaryResponse = HrSummary & {
  metrics?: { totalEmployees?: number; completionRate?: number; coverage?: number };
};
export interface ImportResult {
  success?: true;
  employeeIds?: string[];
  warnings?: string[];
  message?: string;
}
export interface CareerApi {
  getEmployees(signal?: AbortSignal): Promise<Employee[]>;
  getEmployeeView(employeeId: string, signal?: AbortSignal): Promise<EmployeeView>;
  completeActivity(employeeId: string, eventId: string): Promise<EmployeeView>;
  importData(file: File): Promise<ImportResult>;
  getHrSummary(signal?: AbortSignal): Promise<HrSummaryResponse>;
}
export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "ApiError"; }
}
export class CompletionError extends Error {
  constructor(message: string, public readonly phase: "rejected" | "unknown" | "refresh") {
    super(message); this.name = "CompletionError";
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
function backendMessage(body: unknown): string | undefined {
  if (!object(body)) return;
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  if (object(body.error) && typeof body.error.message === "string") return body.error.message;
}

/**
 * Provisional HTTP routes: no server routes were published when this adapter was added.
 * Keep route/response changes here when the backend lands. See docs/FRONTEND_API.md.
 */
export function createCareerApi(options: {
  baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number;
} = {}): CareerApi {
  const root = (options.baseUrl ?? "/api").replace(/\/$/, "");
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 10000;
  async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetcher(root + path, {
        ...init, signal: controller.signal, credentials: "same-origin",
        headers: { Accept: "application/json", ...init.headers },
      });
      const text = await response.text();
      let body: unknown;
      if (text.trim()) {
        try { body = JSON.parse(text); }
        catch { throw new ApiError(response.ok
          ? "The server did not return JSON. Check that the backend API is available."
          : `Request failed (${response.status}).`, response.status); }
      }
      if (!response.ok) throw new ApiError(backendMessage(body) ?? `Request failed (${response.status}).`, response.status);
      return body;
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (timedOut) throw new ApiError("The request timed out. Please try again.");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Could not reach the server. Please check your connection and try again.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
  function invalid(): never { throw new ApiError("The server returned an unexpected response. Please retry or contact your team."); }
  const getEmployeeView: CareerApi["getEmployeeView"] = async (id, signal) => {
    const body = await request(`/employees/${encodeURIComponent(id)}`, {}, signal);
    if (!isEmployeeView(body) || body.employee.employee_id !== id) return invalid();
    return body;
  };
  return {
    async getEmployees(signal) {
      const body = await request("/employees", {}, signal);
      return isEmployeeList(body) ? body : invalid();
    },
    getEmployeeView,
    async completeActivity(employeeId, eventId) {
      let body: unknown;
      try {
        body = await request("/activities/complete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, eventId }),
        });
      } catch (error) {
        const rejected = error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status ?? 0);
        throw new CompletionError(error instanceof Error ? error.message : "Could not complete this activity.", rejected ? "rejected" : "unknown");
      }
      if (isEmployeeView(body) && body.employee.employee_id === employeeId) return body;
      if (body === undefined || (object(body) && body.success === true)) {
        try { return await getEmployeeView(employeeId); }
        catch { throw new CompletionError("Activity completed, but the refreshed profile could not be loaded.", "refresh"); }
      }
      throw new CompletionError("The server did not confirm the updated profile. Reload it before retrying completion.", "unknown");
    },
    async importData(file) {
      if (!/\.(json|csv)$/i.test(file.name)) throw new ApiError("Choose a JSON or CSV file.");
      const form = new FormData();
      form.append("file", file);
      const body = await request("/import", { method: "POST", body: form });
      if (body === undefined) return { success: true };
      return isImportResult(body) ? body : invalid();
    },
    async getHrSummary(signal) {
      const body = await request("/hr/summary", {}, signal);
      return isHrSummary(body) ? body : invalid();
    },
  };
}

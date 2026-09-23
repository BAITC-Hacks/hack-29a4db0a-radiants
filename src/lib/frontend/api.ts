import type { Employee } from "../../types/career";
import type { CatalogResult, EmployeeDetail } from "../../contracts/api";
import type { HrSummary } from "../analytics/hr-summary";
import { isCatalog, isEmployeeDetail, isEmployeeList, isHrSummary, isImportResult } from "./response-validation";

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
  getCatalog(signal?: AbortSignal): Promise<CatalogResult>;
  getEmployees(signal?: AbortSignal): Promise<EmployeeListItem[]>;
  getEmployeeView(employeeId: string, signal?: AbortSignal): Promise<EmployeeDetail>;
  getRecommendations(employeeId: string, signal?: AbortSignal): Promise<EmployeeDetail>;
  completeActivity(employeeId: string, eventId: string): Promise<EmployeeDetail>;
  importData(file: File): Promise<ImportResult>;
  getHrSummary(signal?: AbortSignal): Promise<HrSummaryResponse>;
}
export type EmployeeListItem = Pick<Employee, "employee_id" | "full_name" | "role">;
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
  if (object(body.error) && typeof body.error.message === "string") {
    const details = Array.isArray(body.error.details) ? body.error.details.filter(object).map((item) =>
      [item.file, item.row && `строка ${item.row}`, item.field, item.message].filter(Boolean).join(": ")
    ).join("; ") : "";
    return details || body.error.message;
  }
}

/**
 * Maps the SQLite API envelopes and employee cards to the shared frontend contract.
 * Keep route/response adaptations here. See docs/BACKEND_HANDOFF.md.
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
          ? "Сервер вернул ответ в неверном формате. Попробуйте ещё раз."
          : `Не удалось выполнить запрос (${response.status}).`, response.status); }
      }
      if (!response.ok) throw new ApiError(backendMessage(body) ?? `Не удалось выполнить запрос (${response.status}).`, response.status);
      return object(body) && "data" in body ? body.data : body;
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Запрос отменён", "AbortError");
      if (timedOut) throw new ApiError("Сервер не ответил вовремя. Попробуйте ещё раз.");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте ещё раз.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
  function invalid(): never { throw new ApiError("Не удалось прочитать данные сервера. Попробуйте ещё раз. Если ошибка повторится, обратитесь в поддержку."); }
  const getEmployeeView: CareerApi["getEmployeeView"] = async (id, signal) => {
    const body = await request(`/employees/${encodeURIComponent(id)}`, {}, signal);
    if (!isEmployeeDetail(body) || body.employee.employee_id !== id) return invalid();
    return body;
  };
  return {
    async getCatalog(signal) {
      const body = await request("/catalog", {}, signal);
      return isCatalog(body) ? body : invalid();
    },
    async getEmployees(signal) {
      const body = await request("/employees", {}, signal);
      const items = object(body) && Array.isArray(body.items) ? body.items.map((item: unknown) =>
        object(item) ? { employee_id: item.employeeId, full_name: item.fullName, role: item.role } : item
      ) : body;
      return isEmployeeList(items) ? items : invalid();
    },
    getEmployeeView,
    async getRecommendations(id, signal) {
      const body = await request(`/employees/${encodeURIComponent(id)}/recommendations`, {}, signal);
      if (!isEmployeeDetail(body) || body.employee.employee_id !== id) return invalid();
      return body;
    },
    async completeActivity(employeeId, eventId) {
      let body: unknown;
      try {
        body = await request(`/employees/${encodeURIComponent(employeeId)}/activities/${encodeURIComponent(eventId)}/complete`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch (error) {
        const rejected = error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status ?? 0);
        throw new CompletionError(error instanceof Error ? error.message : "Не удалось отметить мероприятие как завершённое.", rejected ? "rejected" : "unknown");
      }
      if (object(body) && isEmployeeDetail(body.view) && body.view.employee.employee_id === employeeId) return body.view;
      if (isEmployeeDetail(body) && body.employee.employee_id === employeeId) return body;
      if (body === undefined || (object(body) && body.success === true)) {
        try { return await getEmployeeView(employeeId); }
        catch { throw new CompletionError("Мероприятие завершено, но не удалось загрузить обновлённый профиль.", "refresh"); }
      }
      throw new CompletionError("Не удалось подтвердить обновление профиля. Обновите его перед повторной попыткой.", "unknown");
    },
    async importData(file) {
      if (!/\.(json|csv)$/i.test(file.name)) throw new ApiError("Выберите файл JSON или CSV.");
      const form = new FormData();
      form.append(/\.csv$/i.test(file.name) ? "history" : "employees", file);
      const body = await request("/import", { method: "POST", body: form });
      if (body === undefined) return { success: true };
      if (object(body) && typeof body.employeesInserted === "number" && typeof body.employeesUpdated === "number" && typeof body.historyInserted === "number" && typeof body.historySkipped === "number") {
        return {
          success: true,
          ...(Array.isArray(body.employeeIds) && body.employeeIds.every((id) => typeof id === "string") ? { employeeIds: body.employeeIds as string[] } : {}),
          message: `Новых профилей: ${body.employeesInserted}. Обновлённых: ${body.employeesUpdated}. Добавлено записей в историю: ${body.historyInserted}.`,
          warnings: body.historySkipped ? [`Уже существующие записи пропущены: ${body.historySkipped}.`] : [],
        };
      }
      return isImportResult(body) ? body : invalid();
    },
    async getHrSummary(signal) {
      const body = await request("/hr/summary", {}, signal);
      if (!isHrSummary(body)) return invalid();
      // Rates already calculated on the server; do not reconstruct them in the browser.
      const enriched = body as HrSummaryResponse & { population?: number; completionRate?: number };
      return typeof enriched.population === "number" && typeof enriched.completionRate === "number"
        ? { ...body, metrics: { totalEmployees: enriched.population, completionRate: enriched.completionRate } } : body;
    },
  };
}

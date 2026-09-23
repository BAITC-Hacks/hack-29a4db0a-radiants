import type { Employee } from "../../types/career";
import type { ApiErrorDetail, CatalogResult, EmployeeDetail, HrFilters } from "../../contracts/api";
import type { SessionUser } from "../../contracts/auth";
import type { HrSummary } from "../analytics/hr-summary";
import { isAccounts, isCatalog, isEmployeeDetail, isEmployeeList, isHrSummary, isImportResult, isSessionUser } from "./response-validation";

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
  getHrSummary(signal?: AbortSignal, filters?: HrFilters): Promise<HrSummaryResponse>;
  getAccounts(signal?: AbortSignal): Promise<EmployeeAccount[]>;
  createEmployeeAccount(input: { username: string; password: string; employeeId: string }, signal?: AbortSignal): Promise<SessionUser>;
}
export type EmployeeListItem = Pick<Employee, "employee_id" | "full_name" | "role"> & Partial<Pick<Employee, "grade" | "department">>;
export type EmployeeAccount = SessionUser & { active: boolean };
export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string, public readonly details: ApiErrorDetail[] = []) { super(message); this.name = "ApiError"; }
}
export class CompletionError extends ApiError {
  constructor(message: string, public readonly phase: "rejected" | "unknown" | "refresh", cause?: ApiError) {
    super(message, cause?.status, cause?.code, cause?.details); this.name = "CompletionError";
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** User-facing errors never echo arbitrary server messages or exception stacks. */
export function apiErrorMessage(status?: number, code?: string, body?: unknown): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Сессия завершена. Войдите снова.",
    INVALID_CREDENTIALS: "Не удалось войти. Проверьте имя пользователя и пароль.",
    FORBIDDEN: "У вас нет доступа к этому действию.",
    CSRF_INVALID: "Сессия требует обновления. Обновите страницу и повторите действие вручную.",
    ORIGIN_FORBIDDEN: "Адрес приложения не разрешён сервером. Обратитесь к оператору: нужно проверить URL и APP_ORIGIN.",
    VALIDATION_ERROR: "Проверьте отмеченные поля или строки файла.",
    USERNAME_EXISTS: "Это имя пользователя уже занято. Выберите другое.",
    AMBIGUOUS_EMPLOYEE_NAME: "Найдено несколько сотрудников с таким именем. Выберите свой профиль по подразделению и должности.",
    DEMO_ACCOUNT_CONFLICT: "Не удалось открыть демонстрационный доступ. Обратитесь к оператору приложения.",
    EMPLOYEE_NOT_FOUND: "Профиль сотрудника не найден. Сначала импортируйте или выберите существующий профиль.",
    INVALID_JSON: "Не удалось прочитать JSON. Проверьте формат данных.",
    INVALID_MULTIPART: "Не удалось прочитать файл. Выберите файл и повторите загрузку.",
    PAYLOAD_TOO_LARGE: "Файл слишком большой. Уменьшите его размер и повторите загрузку.",
  };
  if (code && messages[code]) return messages[code];
  if (code === "EVENT_NOT_ELIGIBLE") {
    const reasons: Record<string, string> = {
      audience: "Занятие не подходит для текущей или целевой роли и грейда.",
      prerequisites: "Сначала нужно достичь требуемого уровня предварительных навыков.",
      unavailable: "На доступные даты нет сессий занятия.",
      mandatory_assignment_required: "Для обязательного занятия требуется действующее назначение HR или руководителя.",
      invalid_completion_date: "Дата завершения не соответствует доступной сессии или дате демоснимка.",
    };
    const known = [...new Set(apiErrorDetails(body).map((detail) => reasons[detail.message.split(":")[0]!]).filter(Boolean))];
    return known.length ? known.join(" ") : "Условия завершения занятия не выполнены. Обновите профиль и проверьте требования занятия.";
  }
  if (code === "LOGIN_RATE_LIMITED" || status === 429) {
    // Keep a server-provided wait duration, without rendering an arbitrary response body.
    const message = object(body) && object(body.error) && typeof body.error.message === "string" ? body.error.message : "";
    const seconds = message.match(/(?:after|in|через)\s+(\d+)\s*(?:seconds?|сек)/i)?.[1];
    const minutes = message.match(/(?:after|in|через)\s+(\d+)\s*(?:minutes?|мин)/i)?.[1];
    return seconds ? `Слишком много попыток входа. Повторите через ${seconds} сек.` : minutes ? `Слишком много попыток входа. Повторите через ${minutes} мин.` : "Слишком много попыток. Подождите перед следующим входом.";
  }
  if (status === 401) return messages.AUTH_REQUIRED;
  if (status === 403) return messages.FORBIDDEN;
  if (status === 409) return "Действие уже выполнено или данные изменились. Обновите данные перед повтором.";
  if (status === 400 || status === 422) return "Проверьте введённые данные и формат файла.";
  if (status === 404) return "Запрошенные данные не найдены.";
  if (status && status >= 500) return "Сервер временно недоступен. Обновите данные, чтобы узнать результат действия.";
  return "Не удалось выполнить запрос. Повторите позже.";
}

export function apiErrorDetails(body: unknown): ApiErrorDetail[] {
  if (!object(body) || !object(body.error) || !Array.isArray(body.error.details)) return [];
  return body.error.details.filter(object).filter((item) => typeof item.message === "string").map((item) => ({
    ...(typeof item.file === "string" ? { file: item.file } : {}),
    ...(typeof item.row === "number" && Number.isInteger(item.row) && item.row > 0 ? { row: item.row } : {}),
    ...(typeof item.field === "string" ? { field: item.field } : {}),
    message: typeof item.field === "string" && /password/i.test(item.field)
      ? "Пароль должен содержать от 12 до 128 символов."
      : /(?:\b(?:stack|password|cookie|authorization|csrf|secret)\b|\.env\b|^\s*at\s+\S+.*:\d+)/im.test(String(item.message))
        ? "Проверьте значение поля." : String(item.message).slice(0, 500),
  }));
}

/**
 * Maps the SQLite API envelopes and employee cards to the shared frontend contract.
 * Keep route/response adaptations here. See docs/BACKEND_HANDOFF.md.
 */
export function createCareerApi(options: {
  baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number;
  csrfToken?: string; sessionSignal?: AbortSignal; onUnauthorized?: () => void;
} = {}): CareerApi {
  const root = (options.baseUrl ?? "/api").replace(/\/$/, "");
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 10000;
  async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (signal?.aborted || options.sessionSignal?.aborted) controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    options.sessionSignal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetcher(root + path, {
        ...init, signal: controller.signal, credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json",
          ...(init.method && !["GET", "HEAD"].includes(init.method) && options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {}),
          ...init.headers },
      });
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (response.status === 401) options.onUnauthorized?.();
      const text = await response.text();
      let body: unknown;
      if (text.trim()) {
        try { body = JSON.parse(text); }
        catch { throw new ApiError(response.ok
          ? "Сервер вернул данные в неизвестном формате. Обновите страницу."
          : apiErrorMessage(response.status), response.status, "INVALID_RESPONSE"); }
      }
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (!response.ok) {
        const code = object(body) && object(body.error) && typeof body.error.code === "string" ? body.error.code : undefined;
        throw new ApiError(apiErrorMessage(response.status, code, body), response.status, code, apiErrorDetails(body));
      }
      return object(body) && "data" in body ? body.data : body;
    } catch (error) {
      if (signal?.aborted || options.sessionSignal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (timedOut) throw new ApiError("Сервер не ответил вовремя. Обновите данные перед повтором действия.", undefined, "TIMEOUT");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Нет связи с сервером. Проверьте подключение и обновите данные.", undefined, "NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      options.sessionSignal?.removeEventListener("abort", cancel);
    }
  }
  function invalid(): never { throw new ApiError("Ответ сервера не соответствует ожидаемому формату. Обновите данные.", undefined, "INVALID_RESPONSE"); }
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
        object(item) ? {
          employee_id: item.employeeId, full_name: item.fullName, role: item.role,
          ...(typeof item.grade === "string" && ["Junior", "Middle", "Senior", "Lead"].includes(item.grade) ? { grade: item.grade } : {}),
          ...(typeof item.department === "string" ? { department: item.department } : {}),
        } : item
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
        if (error instanceof Error && error.name === "AbortError") throw error;
        const rejected = error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status ?? 0);
        throw new CompletionError(error instanceof ApiError ? error.message : "Не удалось завершить активность.", rejected ? "rejected" : "unknown", error instanceof ApiError ? error : undefined);
      }
      if (object(body) && isEmployeeDetail(body.view) && body.view.employee.employee_id === employeeId) return body.view;
      if (isEmployeeDetail(body) && body.employee.employee_id === employeeId) return body;
      if (body === undefined || (object(body) && body.success === true)) {
        try { return await getEmployeeView(employeeId); }
        catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          throw new CompletionError("Активность завершена, но обновлённый профиль не загрузился.", "refresh", error instanceof ApiError ? error : undefined);
        }
      }
      throw new CompletionError("Сервер не подтвердил обновление профиля. Загрузите профиль перед повтором действия.", "unknown");
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
          message: `Добавлено профилей: ${body.employeesInserted}. Обновлено профилей: ${body.employeesUpdated}. Добавлено записей истории: ${body.historyInserted}.`,
          warnings: body.historySkipped ? [`Пропущено существующих записей истории: ${body.historySkipped}.`] : [],
        };
      }
      return isImportResult(body) ? body : invalid();
    },
    async getHrSummary(signal, filters = {}) {
      const query = new URLSearchParams();
      for (const key of ["role", "grade", "department"] as const) {
        const value = filters[key];
        if (typeof value === "string" && value !== "") query.set(key, value);
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      const body = await request(`/hr/summary${suffix}`, {}, signal);
      if (!isHrSummary(body)) return invalid();
      // Rates already calculated on the server; do not reconstruct them in the browser.
      const enriched = body as HrSummaryResponse & { population?: number; completionRate?: number };
      return typeof enriched.population === "number" && typeof enriched.completionRate === "number"
        ? { ...body, metrics: { totalEmployees: enriched.population, completionRate: enriched.completionRate } } : body;
    },
    async getAccounts(signal) {
      const body = await request("/hr/accounts", {}, signal);
      if (!object(body) || !isAccounts(body.items)) return invalid();
      // Select only the documented public fields; never retain accidental password fields.
      return body.items.map(({ id, username, role, employeeId, active }) => ({ id, username, role, employeeId, active }));
    },
    async createEmployeeAccount(input, signal) {
      const username = input.username.trim().toLowerCase();
      const body = await request("/hr/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: input.password, employeeId: input.employeeId }),
      }, signal);
      if (!isSessionUser(body) || body.role !== "employee" || body.employeeId !== input.employeeId || body.username !== username) return invalid();
      const { id, role, employeeId } = body;
      return { id, username: body.username, role, employeeId };
    },
  };
}

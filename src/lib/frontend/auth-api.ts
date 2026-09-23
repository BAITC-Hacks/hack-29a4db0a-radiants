import type { AuthSession } from "../../contracts/auth";
import { ApiError } from "./api";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
export function isAuthSession(value: unknown): value is AuthSession {
  if (!object(value) || !object(value.user)) return false;
  const { user } = value;
  return typeof user.id === "string" && user.id.length > 0 && typeof user.username === "string" &&
    (user.role === "employee" ? typeof user.employeeId === "string" && user.employeeId.length > 0 : user.role === "hr" && user.employeeId === null) &&
    typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) &&
    typeof value.csrfToken === "string" && value.csrfToken.length > 0;
}

export function createAuthApi(fetcher: typeof fetch = (...args) => fetch(...args), options: { timeoutMs?: number } = {}) {
  async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 10000);
    try {
      const response = await fetcher(`/api/auth/${path}`, {
        ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json", ...init.headers },
      });
      const body: unknown = await response.json();
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (!response.ok) throw new ApiError(
        object(body) && object(body.error) && typeof body.error.message === "string" ? body.error.message : "Could not authenticate.",
        response.status, object(body) && object(body.error) && typeof body.error.code === "string" ? body.error.code : undefined);
      return object(body) ? body.data : undefined;
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (timedOut) throw new ApiError("Authentication request timed out. Please try again.");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Could not reach the authentication service. Please try again.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function sessionResult(value: unknown): Promise<AuthSession> {
    if (!isAuthSession(value)) throw new ApiError("The server returned an invalid session. Please sign in again.");
    return value;
  }
  return {
    async getSession(signal?: AbortSignal): Promise<AuthSession> { return sessionResult(await request("session", {}, signal)); },
    async login(username: string, password: string, signal?: AbortSignal): Promise<AuthSession> {
      return sessionResult(await request("login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
      }, signal));
    },
    async logout(csrfToken: string, signal?: AbortSignal): Promise<void> {
      await request("logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } }, signal);
    },
  };
}

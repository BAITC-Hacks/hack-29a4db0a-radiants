import type { AuthLoginResult, AuthSession, DemoLoginSelection } from "../../contracts/auth";
import { ApiError, apiErrorMessage } from "./api";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
export function isAuthSession(value: unknown): value is AuthSession {
  if (!object(value) || !object(value.user)) return false;
  const { user } = value;
  return typeof user.id === "string" && user.id.length > 0 && typeof user.username === "string" &&
    (user.role === "employee" ? typeof user.employeeId === "string" && user.employeeId.length > 0 : user.role === "hr" && user.employeeId === null) &&
    typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) &&
    typeof value.csrfToken === "string" && value.csrfToken.length > 0;
}

function isDemoLoginSelection(value: unknown): value is DemoLoginSelection {
  return object(value) && value.kind === "employee_selection" && Array.isArray(value.choices) && value.choices.length > 1 &&
    value.choices.every((choice: unknown) => object(choice) &&
      typeof choice.employeeId === "string" && choice.employeeId.length > 0 &&
      typeof choice.fullName === "string" && choice.fullName.length > 0 &&
      typeof choice.department === "string" && typeof choice.role === "string" && typeof choice.grade === "string");
}

export function createAuthApi(fetcher: typeof fetch = (...args) => fetch(...args), options: { timeoutMs?: number } = {}) {
  async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new DOMException("Запрос отменён", "AbortError");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    let rejectAbort!: (reason: DOMException) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(new DOMException("Запрос отменён", "AbortError"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 10000);
    try {
      return await Promise.race([interrupted, (async () => {
        const response = await fetcher(`/api/auth/${path}`, {
          ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store",
          headers: { Accept: "application/json", ...init.headers },
        });
        let body: unknown;
        try { body = await response.json(); }
        catch {
          if (!response.ok) throw new ApiError(apiErrorMessage(response.status), response.status);
          throw new ApiError("Не удалось прочитать ответ сервера. Попробуйте ещё раз.");
        }
        if (controller.signal.aborted) throw new DOMException("Запрос отменён", "AbortError");
        if (!response.ok) {
          const code = object(body) && object(body.error) && typeof body.error.code === "string" ? body.error.code : undefined;
          throw new ApiError(apiErrorMessage(response.status, code, body), response.status, code);
        }
        return object(body) ? body.data : undefined;
      })()]);
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Запрос отменён", "AbortError");
      if (timedOut) throw new ApiError("Сервер не ответил вовремя. Попробуйте ещё раз.");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.");
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function sessionResult(value: unknown): Promise<AuthSession> {
    if (!isAuthSession(value)) throw new ApiError("Не удалось подтвердить вход. Попробуйте войти ещё раз.");
    return value;
  }
  return {
    async getSession(signal?: AbortSignal): Promise<AuthSession> { return sessionResult(await request("session", {}, signal)); },
    async login(username: string, password: string, signal?: AbortSignal, employeeId?: string): Promise<AuthLoginResult> {
      const result = await request("login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, ...(employeeId ? { employeeId } : {}) }),
      }, signal);
      if (isDemoLoginSelection(result)) return { kind: "employee_selection", choices: result.choices.map(({ employeeId, fullName, department, role, grade }) => ({ employeeId, fullName, department, role, grade })) };
      return sessionResult(result);
    },
    async logout(csrfToken: string, signal?: AbortSignal): Promise<void> {
      await request("logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } }, signal);
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
export type AuthPhase = "checking" | "ready" | "signedOut" | "hidden" | "checkFailed" | "signingOut" | "logoutFailed";
export interface AuthSnapshot {
  phase: AuthPhase;
  session: AuthSession | null;
  generation: number;
  signal: AbortSignal;
  notice: string;
}
export interface AuthBroadcast {
  type: "career-quest-auth";
  event: "logout-started" | "logout-finished" | "logout-failed";
  operationId: string;
  startedAt: number;
}

/** No credentials or employee data cross tabs. Messages only cause a locked state or a server check. */
export function isAuthBroadcast(value: unknown): value is AuthBroadcast {
  return object(value) && value.type === "career-quest-auth" &&
    Object.keys(value).every((key) => ["type", "event", "operationId", "startedAt"].includes(key)) &&
    ["logout-started", "logout-finished", "logout-failed"].includes(String(value.event)) &&
    typeof value.operationId === "string" && value.operationId.length > 0 && value.operationId.length <= 100 &&
    typeof value.startedAt === "number" && Number.isFinite(value.startedAt);
}

/** In-memory owner of one mounted App. Every boundary crossing revokes all old request generations. */
export class AuthLifecycle {
  private dataController = new AbortController();
  private request: AbortController | null = null;
  private snapshot: AuthSnapshot = { phase: "checking", session: null, generation: 0, signal: this.dataController.signal, notice: "" };
  private listeners = new Set<() => void>();
  private acceptedAt = 0;
  private requestRevision = 0;
  private logoutOperation: AuthBroadcast | null = null;
  private remoteLogout: AuthBroadcast | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | undefined;
  broadcast: ((message: AuthBroadcast) => void) | undefined;

  constructor(private readonly api: AuthApi) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(phase: AuthPhase, session: AuthSession | null = null, notice = "") {
    this.snapshot = { ...this.snapshot, phase, session, notice };
    this.listeners.forEach((listener) => listener());
  }
  private cancelCheck() {
    this.request?.abort();
    this.request = null;
    this.requestRevision++;
  }
  private revoke() {
    this.cancelCheck();
    this.dataController.abort();
    this.dataController = new AbortController();
    clearTimeout(this.remoteTimer);
    this.snapshot = { ...this.snapshot, generation: this.snapshot.generation + 1, signal: this.dataController.signal };
  }
  private current(generation: number, signal?: AbortSignal) {
    return this.requestRevision === generation && !signal?.aborted;
  }
  private announce(message: AuthBroadcast) {
    try { this.broadcast?.(message); } catch { /* Cross-tab delivery is optional; server authorization remains authoritative. */ }
  }
  accept(session: AuthSession) {
    const previous = this.snapshot.session;
    const sameSession = previous && previous.csrfToken === session.csrfToken && previous.expiresAt === session.expiresAt &&
      previous.user.id === session.user.id && previous.user.username === session.user.username &&
      previous.user.role === session.user.role && previous.user.employeeId === session.user.employeeId;
    if (!sameSession || Date.parse(session.expiresAt) <= Date.now()) this.revoke();
    else this.cancelCheck();
    this.logoutOperation = null;
    this.remoteLogout = null;
    if (Date.parse(session.expiresAt) <= Date.now()) { this.update("signedOut", null, "Время входа истекло. Войдите снова."); return; }
    if (!sameSession) this.acceptedAt = Date.now();
    // Preserve the mounted form/dialog state only after the server confirms the exact same session.
    this.update("ready", sameSession ? previous : session);
  }
  async check() {
    if (this.snapshot.phase === "signingOut" || this.snapshot.phase === "logoutFailed") return;
    this.cancelCheck();
    const generation = this.requestRevision;
    const request = new AbortController();
    this.request = request;
    this.update("checking", this.snapshot.session);
    try {
      const session = await this.api.getSession(request.signal);
      if (this.current(generation, request.signal)) this.accept(session);
    } catch (error) {
      if (!this.current(generation, request.signal)) return;
      this.revoke();
      this.update(error instanceof ApiError && error.status === 401 ? "signedOut" : "checkFailed");
    } finally { if (this.request === request) this.request = null; }
  }
  suspend() {
    if (["signingOut", "logoutFailed"].includes(this.snapshot.phase)) return;
    this.cancelCheck();
    this.update("hidden", this.snapshot.session);
  }
  unauthorized(generation: number) {
    if (generation !== this.snapshot.generation || !this.snapshot.session || !["ready", "checking", "hidden"].includes(this.snapshot.phase)) return;
    this.revoke();
    this.update("signedOut", null, "Время входа истекло. Войдите снова.");
  }
  expire(generation: number) {
    if (generation !== this.snapshot.generation) return;
    this.revoke();
    this.logoutOperation = null;
    this.remoteLogout = null;
    this.update("signedOut", null, "Время входа истекло. Войдите снова.");
  }
  async logout() {
    if (this.snapshot.phase === "signingOut" || (!this.snapshot.session && this.snapshot.phase !== "logoutFailed")) return;
    const retained = this.snapshot.session;
    let target = retained;
    const retry = this.snapshot.phase === "logoutFailed";
    this.revoke();
    const generation = this.requestRevision;
    const request = new AbortController();
    this.request = request;
    const operation: AuthBroadcast = { type: "career-quest-auth", event: "logout-started",
      operationId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, startedAt: Date.now() };
    this.logoutOperation = operation;
    this.remoteLogout = null;
    this.update("signingOut", retained);
    this.announce(operation);
    try {
      // A failed/remote logout may have raced with another login. Ask the server for its current CSRF token.
      const current = retry ? await this.api.getSession(request.signal) : retained!;
      if (!this.current(generation, request.signal)) return;
      target = current;
      this.update("signingOut", current);
      await this.api.logout(current.csrfToken, request.signal);
      if (!this.current(generation, request.signal)) return;
      this.finishLogout(operation);
    } catch (error) {
      if (!this.current(generation, request.signal)) return;
      if (error instanceof ApiError && error.status === 401) this.finishLogout(operation);
      else {
        this.logoutOperation = null;
        this.update("logoutFailed", target);
        this.announce({ ...operation, event: "logout-failed" });
      }
    } finally { if (this.request === request) this.request = null; }
  }
  private finishLogout(operation: AuthBroadcast) {
    this.logoutOperation = null;
    this.revoke();
    this.update("signedOut", null, "Вы вышли из аккаунта.");
    this.announce({ ...operation, event: "logout-finished" });
  }
  receive(message: unknown) {
    if (!isAuthBroadcast(message) || this.logoutOperation) return;
    if (message.startedAt < this.acceptedAt) {
      // An old logout must not clear a new identity, but its cookie response still warrants a server check.
      if (message.event === "logout-finished") void this.check();
      return;
    }
    if (message.event === "logout-started") {
      const retained = this.snapshot.session;
      this.revoke();
      this.remoteLogout = message;
      this.update("signingOut", retained);
      this.remoteTimer = setTimeout(() => {
        if (this.remoteLogout?.operationId === message.operationId) this.update("logoutFailed", retained);
      }, 12000);
      return;
    }
    if (this.remoteLogout && this.remoteLogout.operationId !== message.operationId) return;
    if (message.event === "logout-failed") {
      if (!this.remoteLogout) return;
      clearTimeout(this.remoteTimer);
      this.update("logoutFailed", this.snapshot.session);
    } else {
      this.remoteLogout = null;
      this.revoke();
      this.update("hidden");
      void this.check();
    }
  }
  dispose() { this.revoke(); this.logoutOperation = null; this.remoteLogout = null; this.broadcast = undefined; }
}

/** The same event wiring is exercised by tests without adding a browser-DOM dependency. */
export function bindAuthPageEvents(lifecycle: AuthLifecycle, browser: EventTarget,
  document: EventTarget & { readonly visibilityState: string }, synchronize: (action: () => void) => void) {
  const hide = () => synchronize(() => lifecycle.suspend());
  const resume = () => {
    if (document.visibilityState === "hidden") return;
    hide();
    void lifecycle.check();
  };
  const visibility = () => document.visibilityState === "hidden" ? hide() : resume();
  const restore = (event: Event) => { if ("persisted" in event && event.persisted === true) resume(); };
  browser.addEventListener("focus", resume);
  browser.addEventListener("pagehide", hide);
  browser.addEventListener("pageshow", restore);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    browser.removeEventListener("focus", resume);
    browser.removeEventListener("pagehide", hide);
    browser.removeEventListener("pageshow", restore);
    document.removeEventListener("visibilitychange", visibility);
  };
}

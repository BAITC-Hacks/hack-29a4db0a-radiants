import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../src/contracts/auth";
import { ApiError } from "../src/lib/frontend/api";
import { AuthLifecycle, bindAuthPageEvents, createAuthApi, isAuthBroadcast, type AuthApi, type AuthBroadcast } from "../src/lib/frontend/auth-api";

function session(id = "first"): AuthSession {
  return { user: { id, username: id, role: "employee", employeeId: id }, expiresAt: new Date(Date.now() + 60000).toISOString(), csrfToken: `secret-${id}` };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
}
function transport(): AuthApi {
  return { getSession: vi.fn(async () => session()), login: vi.fn(async () => session()), logout: vi.fn(async () => {}) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("private auth lifecycle", () => {
  it.each(["focus", "visible", "bfcache"])("hides the old App before a %s session check and revokes it when server identity changes", async (event) => {
    const api = transport();
    const pending = deferred<AuthSession>();
    vi.mocked(api.getSession).mockReturnValue(pending.promise);
    const lifecycle = new AuthLifecycle(api);
    lifecycle.accept(session());
    const before = lifecycle.getSnapshot();
    const browser = new EventTarget();
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const synchronize = vi.fn((action: () => void) => action());
    const unbind = bindAuthPageEvents(lifecycle, browser, document, synchronize);
    if (event === "visible") {
      document.visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(lifecycle.getSnapshot().phase).toBe("hidden");
      document.visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    } else if (event === "bfcache") {
      browser.dispatchEvent(new Event("pagehide"));
      expect(lifecycle.getSnapshot().phase).toBe("hidden");
      browser.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    } else browser.dispatchEvent(new Event("focus"));
    expect(synchronize).toHaveBeenCalled();
    expect(before.signal.aborted).toBe(false);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "checking", session: before.session });
    const next = session("second");
    pending.resolve(next);
    await flush();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "ready", session: next });
    expect(before.signal.aborted).toBe(true);
    expect(lifecycle.getSnapshot().generation).toBeGreaterThan(before.generation);
    unbind();
    browser.dispatchEvent(new Event("focus"));
    expect(api.getSession).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });
  it("preserves the App generation, API signal and session object after an exact same-session focus recheck", async () => {
    const api = transport();
    const current = session();
    vi.mocked(api.getSession).mockResolvedValue(structuredClone(current));
    const lifecycle = new AuthLifecycle(api);
    lifecycle.accept(current);
    const before = lifecycle.getSnapshot();
    lifecycle.suspend();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "hidden", session: current });
    await lifecycle.check();
    const after = lifecycle.getSnapshot();
    expect(after.phase).toBe("ready");
    expect(after.generation).toBe(before.generation);
    expect(after.session).toBe(before.session);
    expect(after.signal).toBe(before.signal);
    expect(before.signal.aborted).toBe(false);
    lifecycle.dispose();
  });
  it.each(["token", "role", "employee", "expiry"])("purges a same-account App when its server %s changes", async (field) => {
    const api = transport(); const current = session(); const changed = structuredClone(current);
    if (field === "token") changed.csrfToken = "replacement-token";
    if (field === "role") { changed.user.role = "hr"; changed.user.employeeId = null; }
    if (field === "employee") changed.user.employeeId = "another-employee";
    if (field === "expiry") changed.expiresAt = new Date(Date.now() + 120000).toISOString();
    vi.mocked(api.getSession).mockResolvedValue(changed);
    const lifecycle = new AuthLifecycle(api); lifecycle.accept(current); const before = lifecycle.getSnapshot();
    await lifecycle.check();
    expect(before.signal.aborted).toBe(true);
    expect(lifecycle.getSnapshot().generation).toBeGreaterThan(before.generation);
    expect(lifecycle.getSnapshot().session).toEqual(changed);
    lifecycle.dispose();
  });
  it("does not check while hidden, and a hidden page cancels an ongoing check even if transport ignores abort", async () => {
    const api = transport();
    const pending = deferred<AuthSession>();
    vi.mocked(api.getSession).mockReturnValue(pending.promise);
    const lifecycle = new AuthLifecycle(api);
    const browser = new EventTarget();
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const unbind = bindAuthPageEvents(lifecycle, browser, document, (action) => action());
    browser.dispatchEvent(new Event("focus"));
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.mocked(api.getSession).mock.calls[0]![0]!.aborted).toBe(true);
    browser.dispatchEvent(new Event("focus"));
    pending.resolve(session());
    await flush();
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "hidden", session: null });
    unbind(); lifecycle.dispose();
  });
  it.each(["response", "401"])("ignores a late old session %s and an old App's unauthorized/expiry callbacks", async (result) => {
    const api = transport();
    const old = deferred<AuthSession>();
    vi.mocked(api.getSession).mockReturnValueOnce(old.promise);
    const lifecycle = new AuthLifecycle(api);
    const oldCheck = lifecycle.check();
    const generation = lifecycle.getSnapshot().generation;
    const current = session("second");
    lifecycle.accept(current);
    if (result === "401") old.reject(new ApiError("Old session", 401));
    else old.resolve(session("first"));
    await oldCheck;
    lifecycle.unauthorized(generation);
    lifecycle.expire(generation);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "ready", session: current });
    lifecycle.dispose();
  });
  it("keeps profiles hidden when revalidation fails; retries and treats a current 401 as signed out", async () => {
    const api = transport();
    vi.mocked(api.getSession).mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new ApiError("expired", 401));
    const lifecycle = new AuthLifecycle(api);
    lifecycle.accept(session());
    await lifecycle.check();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "checkFailed", session: null });
    await lifecycle.check();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null });
    lifecycle.dispose();
  });
  it.each(["checking", "hidden"])("a current protected 401 while %s purges the App and invalidates a late successful session check", async (phase) => {
    const api = transport(); const pending = deferred<AuthSession>();
    vi.mocked(api.getSession).mockReturnValue(pending.promise);
    const lifecycle = new AuthLifecycle(api); const current = session(); lifecycle.accept(current);
    const before = lifecycle.getSnapshot();
    const check = lifecycle.check();
    if (phase === "hidden") lifecycle.suspend();
    lifecycle.unauthorized(before.generation);
    expect(before.signal.aborted).toBe(true);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null });
    expect(vi.mocked(api.getSession).mock.calls[0]![0]!.aborted).toBe(true);
    pending.resolve(current); await check;
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null });
    lifecycle.dispose();
  });
  it("locks immediately on failed logout and retries with current server CSRF; focus cannot reopen the profile", async () => {
    const api = transport();
    const first = deferred<void>();
    vi.mocked(api.logout).mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const next = session("second");
    vi.mocked(api.getSession).mockResolvedValue(next);
    const lifecycle = new AuthLifecycle(api);
    lifecycle.accept(session());
    const previous = lifecycle.getSnapshot();
    const pending = lifecycle.logout();
    expect(previous.signal.aborted).toBe(true);
    expect(lifecycle.getSnapshot().phase).toBe("signingOut");
    first.reject(new Error("network")); await pending;
    expect(lifecycle.getSnapshot().phase).toBe("logoutFailed");
    lifecycle.suspend(); await lifecycle.check();
    expect(lifecycle.getSnapshot().phase).toBe("logoutFailed");
    expect(api.getSession).not.toHaveBeenCalled();
    await lifecycle.logout();
    expect(api.logout).toHaveBeenLastCalledWith("secret-second", expect.any(AbortSignal));
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null, notice: "Вы вышли из аккаунта." });
    lifecycle.dispose();
  });
  it("ignores a logout result after another account has been confirmed", async () => {
    const api = transport();
    const pending = deferred<void>();
    vi.mocked(api.logout).mockReturnValue(pending.promise);
    const lifecycle = new AuthLifecycle(api);
    lifecycle.accept(session());
    const logout = lifecycle.logout();
    const current = session("second");
    lifecycle.accept(current);
    pending.resolve(); await logout;
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "ready", session: current });
    lifecycle.dispose();
  });
  it("a current logout 401 is signed out, and local expiry clears failed logout without reopening data", async () => {
    const api = transport(); vi.mocked(api.logout).mockRejectedValueOnce(new ApiError("expired", 401)).mockRejectedValueOnce(new Error("offline"));
    const lifecycle = new AuthLifecycle(api); lifecycle.accept(session());
    await lifecycle.logout();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null });
    lifecycle.accept(session()); await lifecycle.logout();
    expect(lifecycle.getSnapshot().phase).toBe("logoutFailed");
    lifecycle.expire(lifecycle.getSnapshot().generation);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null });
    lifecycle.dispose();
  });
  it("broadcasts no secrets, hides peer data on start, and rechecks the server on completion", async () => {
    const api = transport(); const peerApi = transport();
    const deferredLogout = deferred<void>();
    vi.mocked(api.logout).mockReturnValue(deferredLogout.promise);
    const peerCheck = deferred<AuthSession>();
    vi.mocked(peerApi.getSession).mockReturnValue(peerCheck.promise);
    const first = new AuthLifecycle(api); const peer = new AuthLifecycle(peerApi);
    first.accept(session()); peer.accept(session());
    const oldSignal = peer.getSnapshot().signal;
    const messages: AuthBroadcast[] = [];
    first.broadcast = (message) => { messages.push(message); peer.receive(message); };
    const logout = first.logout();
    expect(peer.getSnapshot().phase).toBe("signingOut");
    expect(oldSignal.aborted).toBe(true);
    expect(peerApi.getSession).not.toHaveBeenCalled();
    deferredLogout.resolve(); await logout;
    expect(peer.getSnapshot()).toMatchObject({ phase: "checking", session: null });
    const canonical = session("new-server-session");
    peerCheck.resolve(canonical); await flush();
    expect(peer.getSnapshot()).toMatchObject({ phase: "ready", session: canonical });
    messages.forEach((message) => expect(Object.keys(message).sort()).toEqual(["event", "operationId", "startedAt", "type"]));
    expect(JSON.stringify(messages)).not.toContain("secret");
    first.dispose(); peer.dispose();
  });
  it("locks a peer on missing/failed logout notification and supports retry even without a retained session", async () => {
    vi.useFakeTimers();
    const api = transport();
    const lifecycle = new AuthLifecycle(api);
    const start: AuthBroadcast = { type: "career-quest-auth", event: "logout-started", operationId: "operation", startedAt: Date.now() };
    lifecycle.receive(start);
    await vi.advanceTimersByTimeAsync(12001);
    expect(lifecycle.getSnapshot().phase).toBe("logoutFailed");
    await lifecycle.logout();
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(lifecycle.getSnapshot().phase).toBe("signedOut");
    lifecycle.dispose();
  });
  it("rejects unrelated or stale broadcasts; never accepts identity or secrets from a message", () => {
    const lifecycle = new AuthLifecycle(transport());
    const current = session("second"); lifecycle.accept(current);
    expect(isAuthBroadcast({ type: "login", session: session() })).toBe(false);
    expect(isAuthBroadcast({ type: "career-quest-auth", event: "logout-started", operationId: "invalid", startedAt: Date.now(), csrfToken: "secret" })).toBe(false);
    lifecycle.receive({ type: "login", session: session() });
    lifecycle.receive({ type: "career-quest-auth", event: "logout-started", operationId: "old", startedAt: 1 });
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "ready", session: current });
    lifecycle.dispose();
  });
  it("does not treat logout as stale merely because the same session was just revalidated", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const api = transport(); const current = session();
    const lifecycle = new AuthLifecycle(api); lifecycle.accept(current);
    vi.mocked(api.getSession).mockResolvedValue(structuredClone(current));
    vi.setSystemTime(2000); await lifecycle.check();
    lifecycle.receive({ type: "career-quest-auth", event: "logout-started", operationId: "in-flight", startedAt: 1500 });
    expect(lifecycle.getSnapshot().phase).toBe("signingOut");
    lifecycle.dispose();
  });
  it("an old logout completion rechecks the cookie without destroying a newly confirmed same-session App", async () => {
    vi.useFakeTimers(); vi.setSystemTime(2000);
    const api = transport(); const current = session("second");
    vi.mocked(api.getSession).mockResolvedValue(structuredClone(current));
    const lifecycle = new AuthLifecycle(api); lifecycle.accept(current); const before = lifecycle.getSnapshot();
    lifecycle.receive({ type: "career-quest-auth", event: "logout-finished", operationId: "old", startedAt: 1000 });
    expect(lifecycle.getSnapshot().phase).toBe("checking");
    await flush();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "ready", session: current, generation: before.generation });
    expect(before.signal.aborted).toBe(false);
    lifecycle.dispose();
  });
  it("disposal revokes data and auth checks; expired sessions cannot mount App", async () => {
    const api = transport(); const pending = deferred<AuthSession>();
    vi.mocked(api.getSession).mockReturnValue(pending.promise);
    const lifecycle = new AuthLifecycle(api);
    lifecycle.accept({ ...session(), expiresAt: new Date(Date.now() - 1).toISOString() });
    expect(lifecycle.getSnapshot().phase).toBe("signedOut");
    const check = lifecycle.check(); const signal = lifecycle.getSnapshot().signal;
    lifecycle.dispose(); pending.resolve(session()); await check;
    expect(signal.aborted).toBe(true);
    expect(lifecycle.getSnapshot().phase).not.toBe("ready");
  });
});

describe("bounded authentication transport", () => {
  it.each([401, 403, 503])("preserves HTTP %s even when an auth error body is not JSON", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("<html>private upstream details</html>", { status }));
    const request = createAuthApi(fetcher).getSession();
    await expect(request).rejects.toMatchObject({ status });
    await expect(request).rejects.not.toThrow("private upstream details");
  });
  it("completes local sign-out on a non-JSON 401 without leaving a false logout-failed state", async () => {
    const lifecycle = new AuthLifecycle(createAuthApi(async () => new Response("unauthorized", { status: 401 })));
    lifecycle.accept(session());
    await lifecycle.logout();
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "signedOut", session: null });
    lifecycle.dispose();
  });
  it.each(["fetch", "body"])("times out even when %s ignores abort", async (stage) => {
    vi.useFakeTimers();
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn<typeof fetch>(stage === "fetch" ? () => never : async () => ({ json: () => new Promise(() => {}) }) as Response);
    const request = createAuthApi(fetcher, { timeoutMs: 20 }).getSession();
    const rejected = expect(request).rejects.toThrow("Сервер не ответил вовремя");
    await vi.advanceTimersByTimeAsync(21); await rejected;
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it("does not start a request for an already cancelled caller and immediately rejects noncooperative cancellation", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const api = createAuthApi(fetcher);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(api.getSession(cancelled.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    const request = api.getSession(controller.signal); controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});

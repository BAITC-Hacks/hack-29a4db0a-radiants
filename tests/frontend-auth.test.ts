import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../src/contracts/auth";
import App from "../src/components/App";
import AuthBoundary, { LoginForm } from "../src/components/AuthBoundary";
import { createAuthApi, isAuthSession } from "../src/lib/frontend/auth-api";
import { createCareerApi } from "../src/lib/frontend/api";

const session = (role: "employee" | "hr" = "employee"): AuthSession => ({
  user: { id: "account-1", username: "individual-user", role, employeeId: role === "employee" ? "E0178" : null },
  expiresAt: "2026-10-01T12:00:00.000Z", csrfToken: "test-csrf-token",
});
afterEach(() => vi.useRealTimers());

describe("session-aware frontend privacy", () => {
  it("does not render protected content before session resolution", () => {
    const html = renderToStaticMarkup(createElement(AuthBoundary));
    expect(html).toContain("Проверяем вход");
    expect(html).not.toContain("Моё развитие");
    expect(html).not.toContain("Обзор команды");
  });
  it("renders a private login form with no embedded credentials or role selector", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { onSignedIn() {} }));
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toContain("test-csrf-token");
    expect(html).not.toContain('id="employee-select"');
    expect(html).not.toContain("Обзор команды");
    expect(html).toContain("Вход в аккаунт");
    expect(html).not.toContain("README");
    expect(html).not.toContain("Демо-режим");
    expect(html).not.toContain("<strong>admin</strong>");
    expect(html).toMatch(/minLength="3"/i);
    expect(html).toMatch(/maxLength="80"/i);
    expect(html).toContain('pattern="');
  });
  it("shows shared demo credentials and full-name validation only with an explicitly enabled flag", () => {
    const disabled = renderToStaticMarkup(createElement(LoginForm, { demoLoginEnabled: false, onSignedIn() {} }));
    expect(disabled).not.toContain("Демо-режим");
    expect(disabled).not.toContain("<strong>admin</strong>");
    const enabled = renderToStaticMarkup(createElement(LoginForm, { demoLoginEnabled: true, onSignedIn() {} }));
    expect(enabled).toContain("Демо-режим: общий доступ");
    expect(enabled).toContain("<strong>admin</strong>");
    expect(enabled).toContain("Имя и фамилия");
    expect(enabled).not.toContain("Ksenia Pavlova (E0058)");
    expect(enabled).toMatch(/minLength="1"/i);
    expect(enabled).toMatch(/maxLength="200"/i);
    expect(enabled).not.toContain('pattern="');
    expect(enabled).not.toContain("доступны вам и HR с правами доступа");
  });
  it("hides employee selection, HR and import for employee accounts", () => {
    const html = renderToStaticMarkup(createElement(App, { api: createCareerApi(), session: session(), onSignOut() {} }));
    expect(html).toContain("Выйти");
    expect(html).toContain("Этот профиль видите только вы и HR.");
    expect(html).not.toContain("Обзор команды");
    expect(html).not.toContain("Загрузить данные");
    expect(html).not.toContain('id="employee-select"');
  });
  it("shows HR navigation, employee selection and import only in HR view", () => {
    const html = renderToStaticMarkup(createElement(App, { api: createCareerApi(), session: session("hr"), onSignOut() {} }));
    expect(html).toContain("Обзор команды");
    expect(html).toContain("Загрузить данные");
    expect(html).toContain('id="employee-select"');
    expect(html).toContain("Прохождение подтверждает сам сотрудник.");
  });
  it("validates the role-to-profile binding and CSRF token from server sessions", () => {
    expect(isAuthSession(session())).toBe(true);
    expect(isAuthSession(session("hr"))).toBe(true);
    expect(isAuthSession({ ...session(), csrfToken: "" })).toBe(false);
    expect(isAuthSession({ ...session(), user: { ...session().user, employeeId: null } })).toBe(false);
    expect(isAuthSession({ ...session(), user: { ...session().user, role: "admin" } })).toBe(false);
    expect(isAuthSession({ ...session(), expiresAt: "not a date" })).toBe(false);
  });
  it("uses same-origin cookies, no-store and a CSRF header for sign-out", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: session() }))
      .mockResolvedValueOnce(Response.json({ data: { signedOut: true } }));
    const api = createAuthApi(fetcher);
    expect(await api.login("individual-user", "private-password")).toEqual(session());
    await api.logout(session().csrfToken);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ username: "individual-user", password: "private-password" });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ "X-CSRF-Token": "test-csrf-token" });
  });
  it("preserves authentication error status and code", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in" } }, { status: 401 }));
    await expect(createAuthApi(fetcher).getSession()).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });
  it.each(["session", "login", "logout"] as const)("aborts a hanging %s request and reports a bounded authentication timeout", async (operation) => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    const api = createAuthApi(fetcher, { timeoutMs: 50 });
    const pending = operation === "session" ? api.getSession() : operation === "login" ? api.login("account", "private-password") : api.logout("csrf");
    const result = expect(pending).rejects.toThrow("Сервер не ответил вовремя");
    await vi.advanceTimersByTimeAsync(51);
    await result;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it("preserves caller cancellation for session checks without reporting a timeout", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    const pending = createAuthApi(fetcher).getSession(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("clears protected data on 401 but does not log out on 403", async () => {
    for (const status of [401, 403]) {
      const onUnauthorized = vi.fn();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "FORBIDDEN", message: "Denied" } }, { status }));
      await expect(createCareerApi({ fetcher, onUnauthorized }).getEmployees()).rejects.toMatchObject({ status });
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    }
  });
  it("passes CSRF for multipart import without overriding browser Content-Type", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { success: true } }));
    await createCareerApi({ fetcher, csrfToken: "current-session-csrf" }).importData(new File(["[]"], "profile.json"));
    const request = fetcher.mock.calls[0]?.[1];
    expect(request).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect(request?.headers).toEqual({ Accept: "application/json", "X-CSRF-Token": "current-session-csrf" });
  });
  it("cancels every pending request when its session is invalidated", async () => {
    const controller = new AbortController();
    const onUnauthorized = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    const api = createCareerApi({ fetcher, sessionSignal: controller.signal, onUnauthorized });
    const pending = [api.getEmployees(), api.getRecommendations("E0178")];
    controller.abort();
    const results = await Promise.allSettled(pending);
    results.forEach((result) => { expect(result).toMatchObject({ status: "rejected", reason: { name: "AbortError" } }); });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it("discards a late old-session 401 without invalidating a newer session", async () => {
    const controller = new AbortController();
    const onUnauthorized = vi.fn();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = createCareerApi({ fetcher, sessionSignal: controller.signal, onUnauthorized }).getEmployees();
    controller.abort();
    resolve(Response.json({ error: { message: "Old session" } }, { status: 401 }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

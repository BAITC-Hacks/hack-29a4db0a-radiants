import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsDialog, EmployeeAccessStatus, accountCreationState, employeeAccessState, validateAccountFields } from "../src/components/AccountsDialog";
import { ApiError, createCareerApi, type EmployeeAccount } from "../src/lib/frontend/api";

const user = { id: "user-42", username: "private.employee", employeeId: "E0042", role: "employee" as const };
const account: EmployeeAccount = { ...user, active: true };
const employees = [{ employee_id: "E0042", full_name: "Мария Соколова", role: "Data Analyst" }];
afterEach(() => vi.useRealTimers());

describe("private employee account management", () => {
  it("reads accounts with the session transport and strips undocumented secret fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { items: [{ ...account, password: "must-not-be-retained", password_hash: "secret-hash" }] } }));
    expect(await createCareerApi({ fetcher }).getAccounts()).toEqual([account]);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/hr/accounts");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("sends only canonical account fields, preserves the whole password and uses current CSRF", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { ...user, password: "do-not-keep" } }, { status: 201 }));
    const input = { username: " Private.Employee ", password: "  a-private-password  ", employeeId: "E0042", role: "hr" };
    expect(await createCareerApi({ fetcher, csrfToken: "current-csrf" }).createEmployeeAccount(input)).toEqual(user);
    const request = fetcher.mock.calls[0]?.[1];
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/hr/accounts");
    expect(request).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(request?.headers).toMatchObject({ "X-CSRF-Token": "current-csrf", "Content-Type": "application/json" });
    expect(JSON.parse(String(request?.body))).toEqual({ username: "private.employee", password: "  a-private-password  ", employeeId: "E0042" });
  });
  it.each([
    { items: [{ ...account, role: "admin" }] },
    { items: [{ ...account, active: 1 }] },
    { items: [{ ...account, employeeId: null }] },
    { items: [account, account] },
    { items: [{ ...account, role: "hr" }] },
  ])("rejects malformed account list %j", async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: body }));
    await expect(createCareerApi({ fetcher }).getAccounts()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([
    { ...user, role: "hr", employeeId: null },
    { ...user, employeeId: "OTHER" },
    { ...user, username: "another.username" },
  ])("rejects a creation confirmation bound to another account", async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: body }, { status: 201 }));
    await expect(createCareerApi({ fetcher }).createEmployeeAccount({ username: user.username, employeeId: user.employeeId, password: "private-long-password" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("retains status/code and structured validation locations without exposing a password value", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: {
      code: "VALIDATION_ERROR", message: "Raw stack: password-secret",
      details: [{ file: "profile.json", row: 3, field: "password", message: "Rejected password-secret" }, { field: "username", message: "Invalid characters" }],
    } }, { status: 422 }));
    const api = createCareerApi({ fetcher });
    const issue = await api.createEmployeeAccount({ username: user.username, employeeId: user.employeeId, password: "password-secret" }).catch((error: unknown) => error);
    expect(issue).toBeInstanceOf(ApiError);
    expect(issue).toMatchObject({ status: 422, code: "VALIDATION_ERROR", details: [{ file: "profile.json", row: 3, field: "password", message: "Пароль должен содержать от 12 до 128 символов." }, { field: "username", message: "Invalid characters" }] });
    expect(JSON.stringify(issue)).not.toContain("password-secret");
    expect((issue as Error).message).not.toContain("Raw stack");
  });
  it.each([[403, "FORBIDDEN"], [403, "CSRF_INVALID"], [403, "ORIGIN_FORBIDDEN"], [409, "USERNAME_EXISTS"], [422, "EMPLOYEE_NOT_FOUND"]] as const)("does not retry or sign out for %s %s", async (status, code) => {
    const onUnauthorized = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code, message: "Raw server details must not be shown" } }, { status }));
    await expect(createCareerApi({ fetcher, onUnauthorized }).createEmployeeAccount({ username: user.username, employeeId: user.employeeId, password: "private-long-password" })).rejects.toMatchObject({ status, code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it("handles any protected 401 including a non-JSON response", async () => {
    const onUnauthorized = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Sign in</html>", { status: 401 }));
    await expect(createCareerApi({ fetcher, onUnauthorized }).getAccounts()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
  it("cancels accounts and account creation on session end; a late 401 has no effect", async () => {
    const controller = new AbortController();
    const onUnauthorized = vi.fn();
    const finish: ((value: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const api = createCareerApi({ fetcher, sessionSignal: controller.signal, onUnauthorized });
    const pending = [api.getAccounts(), api.createEmployeeAccount({ username: user.username, employeeId: user.employeeId, password: "private-long-password" })];
    controller.abort();
    finish.forEach((resolve) => resolve(Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 })));
    const results = await Promise.allSettled(pending);
    results.forEach((result) => expect(result).toMatchObject({ status: "rejected", reason: { name: "AbortError" } }));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it("reports an uncertain timeout and never automatically repeats account creation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
    }));
    const pending = expect(createCareerApi({ fetcher, timeoutMs: 50 }).createEmployeeAccount({ username: user.username, employeeId: user.employeeId, password: "private-long-password" })).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(51);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires explicit profile binding, valid username and an untrimmed 12–128 character password", () => {
    expect(validateAccountFields({ employeeId: "E0042", username: "valid.name", password: " ".repeat(12), confirmed: true }, employees)).toEqual({});
    expect(Object.keys(validateAccountFields({ employeeId: "OTHER", username: "invalid name", password: "short", confirmed: false }, employees))).toHaveLength(4);
    expect(validateAccountFields({ employeeId: "E0042", username: "valid.name", password: "x".repeat(129), confirmed: true }, employees)).toHaveProperty("password");
  });
  it("reconciles an unknown outcome against the exact username/profile binding", () => {
    expect(accountCreationState([account], user)).toBe("found");
    expect(accountCreationState([], user)).toBe("missing");
    expect(accountCreationState([{ ...account, employeeId: "OTHER" }], user)).toBe("conflict");
    expect(accountCreationState([{ ...account, role: "hr", employeeId: null }], user)).toBe("conflict");
  });
  it("does not report no account until an authoritative account list is available", () => {
    expect(employeeAccessState(user.employeeId, null, true, "")).toBe("loading");
    expect(employeeAccessState(user.employeeId, [], true, "")).toBe("loading");
    expect(employeeAccessState(user.employeeId, null, false, "Read failed")).toBe("unavailable");
    expect(employeeAccessState(user.employeeId, [], false, "Read failed")).toBe("unavailable");
    expect(employeeAccessState(user.employeeId, null, false, "")).toBe("unavailable");
    expect(employeeAccessState(user.employeeId, [], false, "")).toBe("none");
    expect(employeeAccessState(user.employeeId, [account], false, "")).toBe("created");
    expect(employeeAccessState(user.employeeId, [{ ...account, active: false }], false, "")).toBe("created");
    expect(employeeAccessState("OTHER", [account], false, "")).toBe("none");
  });
  it("shows clear account status, all linked usernames and honest inactive state", () => {
    const render = (items: EmployeeAccount[] | null, checking = false, error = "") => renderToStaticMarkup(createElement(EmployeeAccessStatus, { employeeId: user.employeeId, accounts: items, checking, error }));
    expect(render([])).toContain("Нет аккаунта");
    expect(render([], true)).not.toContain("Нет аккаунта");
    expect(render([], false, "Read failed")).toContain("Статус аккаунта неизвестен");
    const html = render([account, { ...account, id: "user-43", username: "second.access", active: false }]);
    expect(html).toContain("Аккаунт создан");
    expect(html).toContain("private.employee");
    expect(html).toContain("second.access");
    expect(html).toContain("Неактивен");
    expect(html).not.toContain("Нет аккаунта");
    expect(html).not.toContain("password");
  });
  it("renders a preselected real profile and private password form without fake account actions", () => {
    const html = renderToStaticMarkup(createElement(AccountsDialog, { api: createCareerApi(), employees, initialEmployeeId: "E0042", onClose() {} }));
    expect(html).toContain("Доступ сотрудников");
    expect(html).toContain('value="E0042" selected=""');
    expect(html).toContain("Data Analyst");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain("приватному каналу");
    expect(html).not.toContain('name="role"');
    expect(html).not.toContain("Удалить аккаунт");
    expect(html).not.toContain("Сбросить пароль");
  });
});

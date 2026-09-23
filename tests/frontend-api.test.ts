import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareerApi, CompletionError, apiErrorMessage } from "../src/lib/frontend/api";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView, getRecommendationDiagnostics } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";

const profile = () => {
  const dataset = normalizeDataset(structuredClone(demoDataset));
  return { ...getEmployeeView(dataset, "EMP-014"), completedActivities: [], activeMandatoryObligations: [], activityHistory: [], recommendationDiagnostics: getRecommendationDiagnostics(dataset, "EMP-014") };
};
afterEach(() => vi.useRealTimers());

describe("typed frontend API", () => {
  it("explains completion refusals using known reason codes without echoing arbitrary server text", () => {
    const message = apiErrorMessage(422, "EVENT_NOT_ELIGIBLE", { error: { message: "unexpected server internals", details: [
      { field: "eventId", message: "prerequisites: Activity prerequisites are not met." },
      { field: "completedAt", message: "invalid_completion_date: Invalid date." },
      { field: "eventId", message: "unknown: unexpected server internals" },
    ] } });
    expect(message).toContain("предварительных навыков");
    expect(message).toContain("Дата завершения");
    expect(message).not.toContain("unexpected server internals");
    expect(apiErrorMessage(422, "EVENT_NOT_ELIGIBLE")).toContain("Условия завершения");
  });
  it("localizes demo login errors and preserves the server wait in minutes", () => {
    expect(apiErrorMessage(409, "AMBIGUOUS_EMPLOYEE_NAME")).toContain("по подразделению и должности");
    expect(apiErrorMessage(409, "DEMO_ACCOUNT_CONFLICT")).toContain("Обратитесь к оператору");
    expect(apiErrorMessage(429, "LOGIN_RATE_LIMITED", { error: { message: "Too many login attempts. Try again in 15 minutes" } })).toContain("через 15 мин.");
  });
  it("loads the shared catalog through the existing endpoint", async () => {
    const { skills, events, roleProfiles } = demoDataset;
    const catalog = { skills, events, roleProfiles };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: catalog }));
    expect(await createCareerApi({ fetcher }).getCatalog()).toEqual(catalog);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/catalog");
  });
  it("rejects malformed catalog names while profile requests remain independent", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { skills: [{ skill_id: "SK", name: 5 }], events: [], roleProfiles: [] } }))
      .mockResolvedValueOnce(Response.json({ data: profile() }));
    const api = createCareerApi({ fetcher });
    await expect(api.getCatalog()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(await api.getEmployeeView("EMP-014")).toEqual(profile());
  });
  it("uses the existing recommendations route and preserves the EmployeeDetail envelope", async () => {
    const view = profile();
    view.recommendations[0]!.aiExplanation = "Validated explanation";
    view.recommendations[0]!.explanationSource = "llm";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: view }));
    expect(await createCareerApi({ fetcher }).getRecommendations("EMP-014")).toEqual(view);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/employees/EMP-014/recommendations");
  });
  it("rejects incomplete detail contracts and AI labels without explanation text", async () => {
    const missingHistory = getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014");
    const missingExplanation = profile();
    missingExplanation.recommendations[0]!.explanationSource = "llm";
    for (const body of [missingHistory, missingExplanation]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: body }));
      await expect(createCareerApi({ fetcher }).getRecommendations("EMP-014")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
  it("rejects malformed diagnostics and missing full participation history", async () => {
    const missingHistory = { ...profile(), activityHistory: undefined };
    const badDiagnostics = { ...profile(), recommendationDiagnostics: { status: "no_eligible_events" } };
    for (const body of [missingHistory, badDiagnostics]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: body }));
      await expect(createCareerApi({ fetcher }).getEmployeeView("EMP-014")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
  it("rejects recommendation responses for a different employee", async () => {
    const view = profile();
    view.employee.employee_id = "another";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: view }));
    await expect(createCareerApi({ fetcher }).getRecommendations("EMP-014")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("uses backend-computed values verbatim and encodes arbitrary employee ids", async () => {
    const view = profile();
    view.employee.employee_id = "hidden/id #1";
    view.readiness = 17.3; // Intentionally independent of the skills: the UI must trust the returned value.
    view.recommendations[0]!.score = -5;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(view));
    expect(await createCareerApi({ fetcher }).getEmployeeView(view.employee.employee_id)).toEqual(view);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/employees/hidden%2Fid%20%231");
  });
  it("replaces the profile with a completion response without a duplicate read", async () => {
    const updated = profile();
    updated.readiness = 91.7;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(updated));
    expect(await createCareerApi({ fetcher }).completeActivity("EMP-014", "EV_DEMO_01")).toEqual(updated);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({});
  });
  it("refetches exactly once when completion returns only success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json(profile()));
    expect(await createCareerApi({ fetcher }).completeActivity("EMP-014", "EV_DEMO_01")).toEqual(profile());
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/employees/EMP-014/activities/EV_DEMO_01/complete", "/api/employees/EMP-014"]);
  });
  it("does not retry a mutation if the subsequent profile read fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }));
    await expect(createCareerApi({ fetcher }).completeActivity("EMP-014", "EV_DEMO_01")).rejects.toMatchObject({ phase: "refresh" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("distinguishes a rejected completion from an unknown server outcome", async () => {
    for (const [status, phase] of [[422, "rejected"], [500, "unknown"]] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: "Could not complete" }, { status }));
      await expect(createCareerApi({ fetcher }).completeActivity("EMP-014", "EV_DEMO_01")).rejects.toMatchObject({ phase, status });
    }
  });
  it("retains completion conflict status and code for a read-only profile refresh", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "ALREADY_COMPLETED", message: "Completed already" } }, { status: 409 }));
    await expect(createCareerApi({ fetcher }).completeActivity("EMP-014", "EV_DEMO_01")).rejects.toMatchObject({ phase: "rejected", status: 409, code: "ALREADY_COMPLETED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a completion response for another employee", async () => {
    const view = profile();
    view.employee.employee_id = "someone-else";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(view));
    await expect(createCareerApi({ fetcher }).completeActivity("EMP-014", "event")).rejects.toBeInstanceOf(CompletionError);
  });
  it("rejects malformed profiles and HTML fallback pages as API errors", async () => {
    for (const response of [Response.json({ employee: {} }), new Response("<!doctype html>")]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createCareerApi({ fetcher }).getEmployeeView("EMP-014")).rejects.toThrow();
    }
  });
  it("preserves HR aggregates and does not invent totals when absent", async () => {
    const summary = { weakCompetencies: [], employeesWithoutRecommendations: [], participationByEvent: [] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(summary));
    const result = await createCareerApi({ fetcher }).getHrSummary();
    expect(result).toEqual(summary);
    expect(result.metrics).toBeUndefined();
  });
  it("encodes only canonical HR filters without changing backend aggregates", async () => {
    const summary = { weakCompetencies: [], employeesWithoutRecommendations: [], participationByEvent: [], population: 3, completionRate: 27.4 };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: summary }));
    const filters = { role: "HR Business Partner", grade: "Lead" as const, department: "R&D / Алматы", unauthorizedExtra: "ignore" };
    const result = await createCareerApi({ fetcher }).getHrSummary(undefined, filters);
    const url = new URL(String(fetcher.mock.calls[0]?.[0]), "https://career.example");
    expect(url.pathname).toBe("/api/hr/summary");
    expect(Object.fromEntries(url.searchParams)).toEqual({ role: filters.role, grade: filters.grade, department: filters.department });
    expect(result).toMatchObject({ population: 3, completionRate: 27.4, metrics: { totalEmployees: 3, completionRate: 27.4 } });
  });
  it("omits empty HR filters and preserves the shared session request settings", async () => {
    const summary = { weakCompetencies: [], employeesWithoutRecommendations: [], participationByEvent: [] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(summary));
    await createCareerApi({ fetcher }).getHrSummary(undefined, { role: "", department: "" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/hr/summary");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("preserves valid employee filter metadata and accepts older minimal cards", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { items: [
      { employeeId: "E1", fullName: "Мария", role: "Data Analyst", grade: "Senior", department: "Аналитика" },
      { employeeId: "E2", fullName: "Андрей", role: "Data Analyst" },
      { employeeId: "E3", fullName: "Ольга", role: "Data Analyst", grade: "Unknown", department: 123 },
    ] } }));
    expect(await createCareerApi({ fetcher }).getEmployees()).toEqual([
      { employee_id: "E1", full_name: "Мария", role: "Data Analyst", grade: "Senior", department: "Аналитика" },
      { employee_id: "E2", full_name: "Андрей", role: "Data Analyst" },
      { employee_id: "E3", full_name: "Ольга", role: "Data Analyst" },
    ]);
  });
  it("aborts a slow request and reports timeout without fallback data", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const result = expect(createCareerApi({ fetcher, timeoutMs: 50 }).getEmployees()).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(51);
    await result;
  });
  it("propagates caller cancellation for stale profile requests", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const request = createCareerApi({ fetcher }).getRecommendations("EMP-014", controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});

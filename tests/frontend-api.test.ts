import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareerApi, CompletionError } from "../src/lib/frontend/api";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";

const profile = () => ({ ...getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014"), completedActivities: [], activeMandatoryObligations: [] });
afterEach(() => vi.useRealTimers());

describe("typed frontend API", () => {
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
    await expect(api.getCatalog()).rejects.toThrow("unexpected response");
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
      await expect(createCareerApi({ fetcher }).getRecommendations("EMP-014")).rejects.toThrow("unexpected response");
    }
  });
  it("rejects recommendation responses for a different employee", async () => {
    const view = profile();
    view.employee.employee_id = "another";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: view }));
    await expect(createCareerApi({ fetcher }).getRecommendations("EMP-014")).rejects.toThrow("unexpected response");
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
      await expect(createCareerApi({ fetcher }).completeActivity("EMP-014", "EV_DEMO_01")).rejects.toMatchObject({ phase, message: "Could not complete" });
    }
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
  it("aborts a slow request and reports timeout without fallback data", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const result = expect(createCareerApi({ fetcher, timeoutMs: 50 }).getEmployees()).rejects.toThrow("timed out");
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

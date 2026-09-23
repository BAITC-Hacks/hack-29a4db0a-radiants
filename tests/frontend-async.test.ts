// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/components/App";
import { type CareerApi, type ProfileResponse } from "../src/lib/frontend/api";
import type { Recommendation } from "../src/types/career";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function profile(id: string, readiness = 17.3): ProfileResponse {
  const view = getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014");
  view.employee = { ...view.employee, employee_id: id, full_name: `Employee ${id}` };
  view.readiness = readiness;
  return { ...view, completedActivities: [], activeMandatoryObligations: [] };
}
function recs(label: string) { return profile("E0028").recommendations.map((rec) => ({ ...rec, aiExplanation: label })); }
let root: Root;
let container: HTMLDivElement;
let api: CareerApi;
let requests: { id: string; signal?: AbortSignal; response: ReturnType<typeof deferred<Recommendation[]>> }[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  requests = [];
  api = {
    getEmployees: vi.fn(async () => ["E0028", "E0176", "E0009"].map((id) => ({ employee_id: id, full_name: `Employee ${id}`, role: "Engineer" }))),
    getEmployeeView: vi.fn(async (id) => profile(id)),
    getCatalog: vi.fn(async () => ({ skills: [], events: [] })),
    // Deliberately ignores AbortSignal: guards, not cooperative fetch, must protect the UI.
    getRecommendations: vi.fn((id, signal) => {
      const response = deferred<Recommendation[]>();
      requests.push({ id, signal, response });
      return response.promise;
    }),
    completeActivity: vi.fn(async (id) => profile(id, 63.7)),
    importData: vi.fn(async () => ({ success: true as const, employeeIds: ["E0009"] })),
    getHrSummary: vi.fn(async () => ({ weakCompetencies: [], employeesWithoutRecommendations: [], participationByEvent: [] })),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function mount() { await act(async () => root.render(createElement(App, { api }))); }
async function select(id: string) {
  await act(async () => {
    const element = container.querySelector("select")!;
    element.value = id;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
  expect(button, `Button ${label}`).toBeDefined();
  await act(async () => button!.click());
}
describe("independent profile and recommendation flow", () => {
  it("renders the profile and fallback immediately, then only accepts B when A resolves last", async () => {
    await mount();
    expect(container.textContent).toContain("17.3%");
    expect(container.textContent).toContain("Updating recommendations");
    expect(container.textContent).toContain("System explanation");
    const a = requests[0]!;
    await select("E0176");
    const b = requests[1]!;
    expect(a.signal?.aborted).toBe(true);
    await act(async () => b.response.resolve(recs("CURRENT B")));
    await act(async () => a.response.resolve(recs("STALE A")));
    expect(container.textContent).toContain("CURRENT B");
    expect(container.textContent).not.toContain("STALE A");
    expect(container.querySelector(".profile-name")?.textContent).toContain("E0176");
    expect(container.textContent).toContain("17.3%");
  });
  it("handles three fast switches and a return to the same employee", async () => {
    await mount();
    const old = requests[0]!;
    await select("E0176"); await select("E0009"); await select("E0028");
    await act(async () => requests.at(-1)!.response.resolve(recs("NEW A")));
    await act(async () => old.response.resolve(recs("OLD A")));
    expect(container.textContent).toContain("NEW A");
    expect(container.textContent).not.toContain("OLD A");
  });
  it("cancels before completion starts and rejects responses for the previous profile revision", async () => {
    await mount();
    const old = requests[0]!;
    const mutation = deferred<ProfileResponse>();
    vi.mocked(api.completeActivity).mockImplementation(() => {
      expect(old.signal?.aborted).toBe(true);
      return mutation.promise;
    });
    await click("Complete activity");
    expect(container.textContent).toContain("17.3%");
    expect(container.querySelector(".recommendation-card")).toBeNull();
    await act(async () => old.response.resolve(recs("BEFORE COMPLETION")));
    const updated = profile("E0028", 63.7);
    updated.effectiveSkills.SK_EXTRA = 3;
    updated.completedActivities = [{ record_id: "new", employee_id: "E0028", event_id: "done", eventTitle: "Completed today",
      status: "completed", date: "2026-10-01", due_date: null, completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self" }];
    await act(async () => mutation.resolve(updated));
    expect(requests).toHaveLength(2);
    expect(container.textContent).toContain("63.7%");
    expect(container.textContent).toContain("Completed today");
    expect(container.textContent).not.toContain("BEFORE COMPLETION");
    await act(async () => requests[1]!.response.resolve(recs("AFTER COMPLETION")));
    expect(container.textContent).toContain("AFTER COMPLETION");
    expect(container.textContent).toContain("63.7%");
    expect(container.textContent).toContain("Completed today");
  });
  it("clears previously displayed AI immediately on completion, with no stale flash", async () => {
    await mount();
    await act(async () => requests[0]!.response.resolve(recs("OLD DISPLAYED TEXT")));
    const mutation = deferred<ProfileResponse>();
    vi.mocked(api.completeActivity).mockReturnValue(mutation.promise);
    await click("Complete activity");
    expect(container.textContent).not.toContain("OLD DISPLAYED TEXT");
    await act(async () => mutation.resolve(profile("E0028", 80)));
    expect(container.textContent).not.toContain("OLD DISPLAYED TEXT");
    expect(container.textContent).toContain("80%");
  });
  it("aborts before import, refreshes the imported employee and ignores the old answer", async () => {
    await mount();
    const old = requests[0]!;
    const upload = deferred<{ success: true; employeeIds: string[] }>();
    vi.mocked(api.importData).mockImplementation(() => { expect(old.signal?.aborted).toBe(true); return upload.promise; });
    await click("Import data");
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["{}"], "employee.json", { type: "application/json" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await click("Upload file");
    await act(async () => upload.resolve({ success: true, employeeIds: ["E0009"] }));
    expect(requests.at(-1)?.id).toBe("E0009");
    await act(async () => requests.at(-1)!.response.resolve(recs("IMPORTED PROFILE")));
    await act(async () => old.response.resolve(recs("BEFORE IMPORT")));
    expect(container.textContent).toContain("IMPORTED PROFILE");
    expect(container.textContent).not.toContain("BEFORE IMPORT");
    expect(container.querySelector(".profile-name")?.textContent).toContain("E0009");
  });
  it("keeps deterministic recommendations on AI failure and retries independently", async () => {
    await mount();
    const expected = profile("E0028").recommendations[0]!.deterministicExplanation;
    await act(async () => requests[0]!.response.reject(new Error("AI offline")));
    expect(container.textContent).toContain(expected);
    expect(container.textContent).toContain("System explanation");
    expect(container.textContent).toContain("17.3%");
    await click("Retry recommendations");
    await act(async () => requests.at(-1)!.response.resolve(recs("RECOVERED")));
    expect(container.textContent).toContain("RECOVERED");
    expect(api.getEmployeeView).toHaveBeenCalledTimes(1);
  });
  it("aborts on unmount", async () => {
    await mount();
    const old = requests[0]!;
    await act(async () => root.render(null));
    expect(old.signal?.aborted).toBe(true);
    await act(async () => old.response.resolve(recs("UNMOUNTED")));
    expect(container.textContent).toBe("");
  });
});

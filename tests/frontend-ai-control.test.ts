import { describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "../src/contracts/api";
import { createAiRecommendationRequest, mergeAiExplanations } from "../src/hooks/ai-recommendation-request";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";

function profile(): EmployeeDetail {
  return { ...getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014"),
    completedActivities: [], activeMandatoryObligations: [] };
}
function explained(baseline: EmployeeDetail): EmployeeDetail {
  const incoming = structuredClone(baseline);
  incoming.recommendations.forEach((item) => {
    item.aiExplanation = `Explanation for ${item.eventId}`;
    item.explanationSource = "llm";
  });
  return incoming;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("AI explanation overlay", () => {
  it("only copies explanation fields and keeps the profile, metrics and history references", () => {
    const baseline = profile();
    const incoming = explained(baseline);
    const result = mergeAiExplanations(baseline, incoming)!;
    expect(result.employee).toBe(baseline.employee);
    expect(result.effectiveSkills).toBe(baseline.effectiveSkills);
    expect(result.skillGaps).toBe(baseline.skillGaps);
    expect(result.completedActivities).toBe(baseline.completedActivities);
    expect(result.activeMandatoryObligations).toBe(baseline.activeMandatoryObligations);
    expect(result.readiness).toBe(baseline.readiness);
    expect(result.recommendations[0]!.expectedChanges).toBe(baseline.recommendations[0]!.expectedChanges);
    expect(result.recommendations[0]!.explanationSource).toBe("llm");
    expect(baseline.recommendations[0]!.explanationSource).toBe("fallback");
  });
  it.each([
    ["another employee", (view: EmployeeDetail) => { view.employee.employee_id = "another"; }],
    ["different progress", (view: EmployeeDetail) => { view.readiness += 1; }],
    ["changed evidence", (view: EmployeeDetail) => { view.recommendations[0]!.expectedChanges[0]!.before += 1; }],
    ["changed candidates", (view: EmployeeDetail) => { view.recommendations[0]!.eventId = "unknown"; }],
    ["changed score", (view: EmployeeDetail) => { view.recommendations[0]!.score += 1; }],
    ["changed profile", (view: EmployeeDetail) => { view.employee.department = "Imported department"; }],
  ] as const)("discards a response with %s", (_label, change) => {
    const baseline = profile();
    const incoming = explained(baseline);
    change(incoming);
    expect(mergeAiExplanations(baseline, incoming)).toBeNull();
  });
  it("keeps deterministic explanations when the backend returns fallback", () => {
    const baseline = profile();
    expect(mergeAiExplanations(baseline, structuredClone(baseline))).toEqual(baseline);
  });
});

describe("AI request lifecycle", () => {
  it.each(["employee selection", "HR navigation", "completion start", "import start", "unmount"])(
    "aborts on %s and discards late success even if transport ignores cancellation", async () => {
      const pending = deferred<EmployeeDetail>();
      const baseline = profile();
      const load = vi.fn<(id: string, signal: AbortSignal) => Promise<EmployeeDetail>>().mockImplementation(() => pending.promise);
      const onResult = vi.fn();
      const onFailure = vi.fn();
      const requests = createAiRecommendationRequest();
      const done = requests.run(baseline, load, onResult, onFailure);
      requests.cancel();
      expect(load.mock.calls[0]![1].aborted).toBe(true);
      pending.resolve(explained(baseline));
      await done;
      expect(onResult).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    });
  it("discards late errors after cancellation", async () => {
    const pending = deferred<EmployeeDetail>();
    const onFailure = vi.fn();
    const requests = createAiRecommendationRequest();
    const done = requests.run(profile(), () => pending.promise, vi.fn(), onFailure);
    requests.cancel();
    pending.reject(new Error("timeout"));
    await done;
    expect(onFailure).not.toHaveBeenCalled();
  });
  it("only delivers the latest request after completion of the same employee", async () => {
    const pending = deferred<EmployeeDetail>();
    const before = profile();
    const after = profile();
    after.readiness += 1;
    const results = vi.fn();
    const requests = createAiRecommendationRequest();
    const old = requests.run(before, () => pending.promise, results, vi.fn());
    await requests.run(after, async () => explained(after), results, vi.fn());
    pending.resolve(explained(before));
    await old;
    expect(results).toHaveBeenCalledTimes(1);
    expect(results.mock.calls[0]![0].readiness).toBe(after.readiness);
  });
  it("reports failure while leaving the baseline owned by the caller unchanged", async () => {
    const baseline = profile();
    const onFailure = vi.fn();
    const onResult = vi.fn();
    await createAiRecommendationRequest().run(baseline, async () => { throw new Error("timeout"); }, onResult, onFailure);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(baseline).toEqual(profile());
  });
});

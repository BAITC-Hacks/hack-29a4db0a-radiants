import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmployeeScreen, CompletionFeedback } from "../src/components/EmployeeScreen";
import { HRDashboard } from "../src/components/HRDashboard";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";
import { CompletionError } from "../src/lib/frontend/api";

const profile = () => getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014");
const screen = (view: ReturnType<typeof profile>) => renderToStaticMarkup(createElement(EmployeeScreen, {
  view, completing: false, completionDisabled: false, completion: null, failure: null,
  onRefresh() {}, onComplete() {}, onDismissCompletion() {},
}));
describe("presentation of trusted EmployeeView values", () => {
  it("shows all supplied reasons, projected levels, expected impacts and optional AI insight", () => {
    const view = profile();
    view.readiness = 64.2;
    view.skillGaps[0]!.projectedLevel = 3.5;
    view.recommendations[0]!.reasons = ["Reason one", "Reason two", "Reason three", "Reason four"];
    view.recommendations[0]!.aiExplanation = "Supplied AI insight";
    const html = screen(view);
    expect(html).toContain("64.2%");
    expect(html).toContain("Current progress");
    expect(html).toContain("Projected");
    expect(html).toContain("3.5");
    expect(html).toContain("EXPECTED SKILL IMPACT");
    expect(html).toContain("Reason four");
    expect(html).toContain("Supplied AI insight");
  });
  it("works without AI text and escapes any supplied HTML", () => {
    const view = profile();
    view.recommendations[0]!.aiExplanation = " ";
    view.recommendations[0]!.reasons = ["<script>injected()</script>"];
    const html = screen(view);
    expect(html).not.toContain("AI insight");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("shows a neutral empty state without inventing a catalog or grade reason", () => {
    const view = profile();
    view.recommendations = [];
    const html = screen(view);
    expect(html).toContain("No suitable next step is currently available.");
    expect(html).not.toContain("catalog has no");
    expect(html).not.toContain("highest grade");
  });
  it("compares actual before/after views and uses percentage points for readiness delta", () => {
    const before = profile();
    const after = structuredClone(before);
    before.readiness = 64.2;
    after.readiness = 71.5;
    after.effectiveSkills.SK_SYS = 5; // Actual result deliberately differs from the recommendation preview.
    const html = renderToStaticMarkup(createElement(CompletionFeedback, { snapshot: { before, after }, onDismiss() {} }));
    expect(html).toContain("64.2% → 71.5%");
    expect(html).toContain("+7.3 percentage points");
    expect(html).toContain("3 → 5");
  });
  it("does not celebrate a zero readiness delta", () => {
    const view = profile();
    view.readiness = 64.2;
    const html = renderToStaticMarkup(createElement(CompletionFeedback, { snapshot: { before: view, after: view }, onDismiss() {} }));
    expect(html).toContain("Your development profile has been updated.");
    expect(html).toContain("Readiness remains at 64.2%.");
    expect(html).not.toContain("+0");
  });
  it("shows negative readiness changes without inventing an explanation", () => {
    const before = profile();
    const after = structuredClone(before);
    before.readiness = 64.2;
    after.readiness = 63.7;
    const html = renderToStaticMarkup(createElement(CompletionFeedback, { snapshot: { before, after }, onDismiss() {} }));
    expect(html).toContain("64.2% → 63.7%");
    expect(html).toContain("-0.5 percentage points");
    expect(html).not.toContain("increased");
  });
  it("uses identical readiness precision for visible and accessible progress labels", () => {
    const view = profile();
    view.readiness = 71.499999999;
    const html = screen(view);
    expect(html).toContain('aria-valuetext="71.5%"');
    expect(html).toContain('max="100">71.5%</progress>');
    view.readiness = 64;
    expect(screen(view)).toContain('aria-valuetext="64%"');
  });
  it("renders server-computed progress without changing assessed skills or either view", () => {
    const before = profile();
    const after = structuredClone(before);
    const baseline = structuredClone(before.employee.skills);
    after.effectiveSkills.SK_SYS = 5;
    after.skillGaps[0]!.currentLevel = 5;
    after.skillGaps[0]!.projectedLevel = 5;
    const original = structuredClone({ before, after });
    // Freeze recursively so any render-time mutation also fails immediately.
    function freeze(value: object) {
      Object.values(value).forEach((child) => { if (child && typeof child === "object") freeze(child); });
      Object.freeze(value);
    }
    freeze(before);
    freeze(after);
    screen(after);
    const html = renderToStaticMarkup(createElement(CompletionFeedback, { snapshot: { before, after }, onDismiss() {} }));
    expect(html).toContain("3 → 5");
    expect(after.employee.skills).toEqual(baseline);
    expect({ before, after }).toEqual(original);
  });
  it("keeps the previous profile visible on rejected completion and blocks duplicate clicks while pending", () => {
    const view = profile();
    const original = structuredClone(view);
    const props = { view, completion: null, onRefresh() {}, onComplete() {}, onDismissCompletion() {} };
    const errorHtml = renderToStaticMarkup(createElement(EmployeeScreen, {
      ...props, completing: false, completionDisabled: false,
      failure: new CompletionError("Activity was rejected.", "rejected"),
    }));
    expect(errorHtml).toContain("Could not complete this activity.");
    expect(errorHtml).toContain("Your progress has not been changed.");
    expect(errorHtml).toContain("87.5%");
    expect(view).toEqual(original);
    const pendingHtml = renderToStaticMarkup(createElement(EmployeeScreen, {
      ...props, completing: true, completionDisabled: true, failure: null,
    }));
    expect(pendingHtml).toContain('complete-button" disabled=""');
    expect(pendingHtml).toContain("Updating profile…");
    expect(pendingHtml).toContain("87.5%");
    expect(view).toEqual(original);
  });
  it("shows supplied HR counts without deriving missing metrics or statuses", () => {
    const html = renderToStaticMarkup(createElement(HRDashboard, {
      summary: { weakCompetencies: [], employeesWithoutRecommendations: [],
        participationByEvent: [{ eventId: "EVENT", title: "Workshop", total: 19, byStatus: { completed: 4 } }] },
      onSelect() {},
    }));
    expect(html).toContain("Workshop");
    expect(html).toContain(">19<");
    expect(html).toContain(">4<");
    expect(html).toContain("—");
    expect(html).not.toContain("Completion rate");
  });
});

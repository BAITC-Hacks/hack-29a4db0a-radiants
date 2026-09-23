import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmployeeScreen, CompletionFeedback } from "../src/components/EmployeeScreen";
import { HRDashboard } from "../src/components/HRDashboard";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";

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
    expect(html).toContain("Effective / projected");
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
    after.readiness = 71.3;
    after.effectiveSkills.SK_SYS = 5; // Actual result deliberately differs from the recommendation preview.
    const html = renderToStaticMarkup(createElement(CompletionFeedback, { snapshot: { before, after }, onDismiss() {} }));
    expect(html).toContain("64.2% → 71.3%");
    expect(html).toContain("+7.1 percentage points");
    expect(html).toContain("3 → 5");
  });
  it("does not celebrate a zero readiness delta", () => {
    const view = profile();
    const html = renderToStaticMarkup(createElement(CompletionFeedback, { snapshot: { before: view, after: view }, onDismiss() {} }));
    expect(html).toContain("Your profile has been updated.");
    expect(html).not.toContain("+0");
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

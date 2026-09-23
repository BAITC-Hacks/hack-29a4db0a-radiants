import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmployeeScreen, CompletionFeedback } from "../src/components/EmployeeScreen";
import { HRDashboard } from "../src/components/HRDashboard";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";
import { CompletionError } from "../src/lib/frontend/api";
import type { ActivityView, EmployeeDetail } from "../src/contracts/api";

const profile = () => getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014");
const screen = (view: ReturnType<typeof profile> & Partial<Pick<EmployeeDetail, "completedActivities" | "activeMandatoryObligations">>, skillNames?: Record<string, string>) => renderToStaticMarkup(createElement(EmployeeScreen, {
  view, skillNames, completing: false, completionDisabled: false, completion: null, failure: null,
  onRefresh() {}, onComplete() {}, onDismissCompletion() {},
}));
describe("presentation of trusted EmployeeView values", () => {
  it("labels gains with a zero target requirement without inventing a requirement", () => {
    const view = profile();
    const change = view.recommendations[0]!.expectedChanges[0]!;
    change.required = 0;
    change.before = 1;
    change.after = 2;
    const html = screen(view);
    expect(html).toContain('1 <span aria-label="to">→</span> 2');
    expect(html).toContain("Not required by target");
    expect(html).not.toContain(" /  required");
    expect(html).not.toContain("null required");
    expect(html).not.toContain(" / 0 required");
    change.required = 3;
    expect(screen(view)).toContain(" / 3 required");
  });
  it("shows every reported effective skill for an employee without a target", () => {
    const view = profile();
    view.target = null;
    view.targetStatus = "needs_career_goal";
    view.skillGaps = [];
    view.recommendations = [];
    view.readiness = 0;
    view.effectiveSkills = { SK_KNOWN: 4, SK_ZERO: 0, SK_UNKNOWN: 2 };
    const original = structuredClone(view);
    const html = screen(view, { SK_KNOWN: "Catalog skill", SK_ZERO: "Zero-level skill" });
    expect(html).toContain("Current effective skill levels");
    expect(html).toContain('scope="row">Catalog skill</th><td>4</td>');
    expect(html).toContain('scope="row">Zero-level skill</th><td>0</td>');
    expect(html).toContain('scope="row">SK_UNKNOWN</th><td>2</td>');
    expect(html).toContain("Career goal needed");
    expect(html).not.toContain("No current skill levels were provided");
    expect(view).toEqual(original);
  });
  it("shows skills outside target requirements without duplicating requirement rows", () => {
    const view = profile();
    view.effectiveSkills.EXTRA_SKILL = 4;
    const html = screen(view, { EXTRA_SKILL: "Additional skill" });
    expect(html).toContain("Other current skills");
    expect(html).toContain('scope="row">Additional skill</th><td>4</td>');
    const currentTable = html.slice(html.indexOf('aria-label="Current skill levels"'));
    const rows = currentTable.slice(0, currentTable.indexOf("</table>"));
    view.skillGaps.forEach((gap) => { expect(rows).not.toContain(gap.name); });
  });
  it("renders skill IDs immediately when the optional catalog is loading or unavailable", () => {
    const view = profile();
    view.effectiveSkills.EXTRA_SKILL = 3;
    const html = screen(view);
    expect(html).toContain('scope="row">EXTRA_SKILL</th><td>3</td>');
    expect(html).toContain("Recommended next steps");
  });
  it("shows an explicit empty state for a no-target profile with no reported skills", () => {
    const view = profile();
    view.target = null;
    view.targetStatus = "needs_career_goal";
    view.skillGaps = [];
    view.recommendations = [];
    view.effectiveSkills = {};
    expect(screen(view)).toContain("No current skill levels were provided.");
  });
  it("shows all supplied reasons, projected levels, expected impacts and optional AI insight", () => {
    const view = profile();
    view.readiness = 64.2;
    view.skillGaps[0]!.projectedLevel = 3.5;
    view.recommendations[0]!.reasons = ["Reason one", "Reason two", "Reason three", "Reason four"];
    view.recommendations[0]!.aiExplanation = "Supplied AI insight";
    view.recommendations[0]!.explanationSource = "llm";
    const html = screen(view);
    expect(html).toContain("64.2%");
    expect(html).toContain("Current progress");
    expect(html).toContain("Projected");
    expect(html).toContain("3.5");
    expect(html).toContain("Expected skill changes");
    expect(html).toContain("Reason four");
    expect(html).toContain("Supplied AI insight");
    expect(html).toContain("AI-assisted explanation");
    expect(html).toContain('<table class="skills-table">');
    expect(html).not.toContain('class="ring"');
    expect(html).not.toContain("Evidence based");
  });
  it("works without AI text and escapes any supplied HTML", () => {
    const view = profile();
    view.recommendations[0]!.aiExplanation = " ";
    view.recommendations[0]!.explanationSource = "llm";
    view.recommendations[0]!.reasons = ["<script>injected()</script>"];
    const html = screen(view);
    expect(html).not.toContain("AI-assisted explanation");
    expect(html).toContain("Rule-based explanation");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("does not label stale AI text as trusted when the source is fallback", () => {
    const view = profile();
    view.recommendations.forEach((rec) => { rec.explanationSource = "fallback"; });
    view.recommendations[0]!.aiExplanation = "Untrusted stale AI text";
    view.recommendations[0]!.deterministicExplanation = "Verified rule-based evidence";
    const html = screen(view);
    expect(html).toContain("Rule-based explanation");
    expect(html).toContain("Verified rule-based evidence");
    expect(html).not.toContain("AI-assisted explanation");
    expect(html).not.toContain("Untrusted stale AI text");
  });
  it("shows completed history and mandatory obligations from EmployeeDetail in separate tables", () => {
    const record: ActivityView = {
      record_id: "REC-OLD", employee_id: "EMP-014", event_id: "EV-RECORDED", eventTitle: "Recorded course",
      date: "2026-09-01", due_date: null, status: "completed", completion_pct: 100,
      score: null, feedback_rating: null, assigned_by: "self",
    };
    const view: EmployeeDetail = {
      ...profile(), completedActivities: [record, { ...record, record_id: "REC-NEW", eventTitle: "Latest recorded course", date: "2026-10-01" }],
      activeMandatoryObligations: [
        { ...record, record_id: "MANDATORY-OVERDUE", event_id: "EV-REQUIRED", eventTitle: "Required compliance", status: "overdue", completion_pct: 25, due_date: "2026-09-30" },
        { ...record, record_id: "MANDATORY-ACTIVE", eventTitle: "Required onboarding", status: "in_progress", completion_pct: 50 },
      ],
    };
    const original = structuredClone(view);
    const html = screen(view);
    expect(html).toContain("Completed activities");
    expect(html).toContain("Mandatory obligations");
    expect(html).toContain("Required activities, separate from career recommendations");
    expect(html).toContain('aria-label="Mandatory activity records"');
    expect(html).toContain('aria-label="Completed activity records"');
    expect(html).toContain("Required compliance");
    expect(html).toContain("Overdue");
    expect(html).toContain("In progress");
    expect(html).toContain("25%");
    expect(html).toContain("100%");
    expect(html).toContain('<time dateTime="2026-09-30">2026-09-30</time>');
    expect(html).toContain("Not provided");
    const completedTable = html.slice(html.indexOf('aria-label="Completed activity records"'));
    expect(completedTable.indexOf("Latest recorded course")).toBeLessThan(completedTable.indexOf('scope="row">Recorded course'));
    expect(view).toEqual(original);
    expect(html.split("Complete activity").length - 1).toBe(view.recommendations.length);
  });
  it("shows history empty states only for supplied empty arrays", () => {
    const html = screen({ ...profile(), completedActivities: [], activeMandatoryObligations: [] });
    expect(html).toContain("No completed activities recorded.");
    expect(html).toContain("No active mandatory obligations.");
    const legacyHtml = screen(profile());
    expect(legacyHtml).not.toContain("No completed activities recorded.");
    expect(legacyHtml).not.toContain("No active mandatory obligations.");
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
  it("presents HR gaps and follow-up employees as tables with meaningful statuses", () => {
    const html = renderToStaticMarkup(createElement(HRDashboard, {
      summary: {
        weakCompetencies: [{ skillId: "SK_A", name: "Analysis", employeesBelowRequirement: 7 }],
        employeesWithoutRecommendations: [{ employeeId: "EMP-X", fullName: "Test Profile", reason: "needs_career_goal" }],
        participationByEvent: [],
      }, onSelect() {},
    }));
    expect(html).toContain("Common skill gaps");
    expect(html).toContain('scope="row">Analysis');
    expect(html).toContain('class="number">7');
    expect(html).toContain('class="text-button">Test Profile');
    expect(html).toContain("Career goal needed");
    expect(html).not.toContain("avatar");
  });
});

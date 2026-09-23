import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmployeeScreen } from "../src/components/EmployeeScreen";
import { ActivityHistory } from "../src/components/ActivityHistory";
import type { ActivityView } from "../src/contracts/api";
import type { ProfileResponse } from "../src/lib/frontend/api";
import type { ActivityStatus } from "../src/types/career";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { demoDataset } from "./fixtures/career-dataset";

const profile = (): ProfileResponse => ({ ...getEmployeeView(normalizeDataset(structuredClone(demoDataset)), "EMP-014"), completedActivities: [], activeMandatoryObligations: [] });
const render = (view: ProfileResponse) => renderToStaticMarkup(createElement(EmployeeScreen, {
  view, completing: false, completionDisabled: false, completion: null, failure: null,
  onRefresh() {}, onComplete() {}, onDismissCompletion() {},
  catalog: { skills: [{ skill_id: "MENTOR", name: "Mentoring" }], events: [] },
}));
const record = (status: ActivityStatus, index: number): ActivityView => ({
  record_id: `row-${index}`, event_id: "workshop", employee_id: "EMP-014", eventTitle: `Workshop ${index}`,
  date: `2026-09-${String(index + 1).padStart(2, "0")}`, due_date: null, status, completion_pct: 35,
  assigned_by: "manager", score: null, feedback_rating: null,
});
describe("history and skills presentation", () => {
  it("shows every supplied status, newest first, and available source/duration", () => {
    const view = profile();
    view.activeMandatoryObligations = (["completed", "in_progress", "dropped", "declined", "no_show", "overdue"] as const).map(record);
    const html = renderToStaticMarkup(createElement(ActivityHistory, { view,
      catalog: { skills: [], events: [{ event_id: "workshop", title: "Workshop", duration_hours: 2.5 }] } }));
    for (const label of ["Completed", "In progress", "Dropped", "Declined", "No show", "Overdue", "35%", "Manager", "2.5 h"]) expect(html).toContain(label);
    expect(html.indexOf("Workshop 5")).toBeLessThan(html.indexOf("Workshop 0"));
    expect(view.activeMandatoryObligations[0]?.eventTitle).toBe("Workshop 0");
  });
  it("distinguishes empty history from unavailable history", () => {
    const view = profile();
    expect(render(view)).toContain("No activity history was returned");
    delete view.completedActivities; delete view.activeMandatoryObligations;
    expect(render(view)).toContain("Activity history is not available");
  });
  it("retains all long-history rows in a scrollable table, deduplicates ids and excludes another employee", () => {
    const view = profile();
    view.completedActivities = Array.from({ length: 180 }, (_, index) => ({ ...record("completed", index), date: "2026-09-01" }));
    view.activeMandatoryObligations = [view.completedActivities[0]!, { ...record("dropped", 200), employee_id: "other", eventTitle: "FOREIGN" }];
    const html = render(view);
    expect(html).toContain("history-scroll");
    expect(html.match(/Workshop \d+/g)).toHaveLength(180);
    expect(html).not.toContain("FOREIGN");
  });
  it("shows untargeted effective skills with their level and no fabricated requirement", () => {
    const view = profile();
    view.effectiveSkills.MENTOR = 3;
    const html = render(view);
    expect(html).toContain('Mentoring</th><td>3</td>');
    expect(html).toContain("Additional skills");
    expect(html).not.toContain("3 / 5");
    view.target = null; view.targetStatus = "needs_career_goal"; view.skillGaps = [];
    expect(render(view)).toContain('Mentoring</th><td>3</td>');
  });
});
describe("explanation and source follow the displayed text", () => {
  it.each([undefined, null, "", "   "])("falls back for AI value %s, regardless of declared source", (ai) => {
    const view = profile();
    Object.assign(view.recommendations[0]!, { aiExplanation: ai, deterministicExplanation: "FALLBACK TEXT", explanationSource: "llm" });
    const html = render(view);
    expect(html).toContain("FALLBACK TEXT");
    expect(html).toContain("System explanation");
    expect(html).not.toContain("AI-assisted");
  });
  it("shows trimmed nonempty AI text and retains structured reasons", () => {
    const view = profile();
    Object.assign(view.recommendations[0]!, { aiExplanation: "  AI TEXT  ", deterministicExplanation: "UNUSED FALLBACK", explanationSource: "fallback", reasons: ["Structured reason"] });
    const html = render(view);
    expect(html).toContain("<p>AI TEXT</p>");
    expect(html).toContain("AI-assisted");
    expect(html).toContain("Structured reason");
    expect(html).not.toContain("UNUSED FALLBACK");
  });
});

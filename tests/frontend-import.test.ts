import { describe, expect, it } from "vitest";
import { demoDataset } from "../src/lib/frontend/demo-data";
import { parseImportText } from "../src/lib/frontend/dataset";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";

describe("frontend data import", () => {
  it("adds an employee profile from JSON without replacing existing profiles", () => {
    const employee = {
      ...demoDataset.employees[0]!, employee_id: "EMP-NEW", full_name: "Test Employee",
    };
    const next = parseImportText(JSON.stringify([employee]), "employees.json", structuredClone(demoDataset));
    expect(next.employees.map((item) => item.employee_id)).toContain("EMP-NEW");
    expect(next.employees).toHaveLength(demoDataset.employees.length + 1);
  });

  it("opens recommendations for a newly imported employee without source changes", () => {
    const employee = { ...demoDataset.employees[0]!, employee_id: "EMP-NEW", full_name: "Test Employee" };
    const next = parseImportText(JSON.stringify({ employees: [employee] }), "profiles.json", structuredClone(demoDataset));
    const view = getEmployeeView(normalizeDataset(next), "EMP-NEW");
    expect(view.target?.grade).toBe("Senior");
    expect(view.recommendations.length).toBeGreaterThan(0);
  });

  it("merges multiple history records by record id, not employee id", () => {
    const records = ["R-1", "R-2"].map((record_id) => ({
      record_id, employee_id: "EMP-014", event_id: "EV_DEMO_01", date: "2026-10-01", due_date: null,
      status: "completed", completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self",
    }));
    const next = parseImportText(JSON.stringify({ history: records }), "history.json", structuredClone(demoDataset));
    expect(next.history.filter((item) => item.employee_id === "EMP-014")).toHaveLength(3);
  });

  it("imports CSV activity history and parses quoted values", () => {
    const csv = 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nR-3,EMP-014,EV_DEMO_01,2026-10-01,,completed,100,,,self';
    const next = parseImportText(csv, "activity_history.csv", structuredClone(demoDataset));
    expect(next.history.some((item) => item.record_id === "R-3" && item.status === "completed")).toBe(true);
  });

  it("reconstructs skills from imported post-review activity and excludes the completed event", () => {
    const record = {
      record_id: "R-COMPLETE", employee_id: "EMP-014", event_id: "EV_DEMO_01", date: "2026-10-01", due_date: null,
      status: "completed", completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self",
    };
    const next = parseImportText(JSON.stringify({ history: [record] }), "history.json", structuredClone(demoDataset));
    const view = getEmployeeView(normalizeDataset(next), "EMP-014");
    expect(view.effectiveSkills.SK_SYS).toBe(4);
    expect(view.recommendations.some((item) => item.eventId === "EV_DEMO_01")).toBe(false);
  });

  it("rejects malformed data and an imported employee without target requirements", () => {
    expect(() => parseImportText("{nope", "employees.json", structuredClone(demoDataset))).toThrow();
    const employee = { ...demoDataset.employees[0]!, employee_id: "EMP-BAD", role: "Unknown role" };
    expect(() => parseImportText(JSON.stringify([employee]), "employees.json", structuredClone(demoDataset))).toThrow(/No role requirements/);
  });
});

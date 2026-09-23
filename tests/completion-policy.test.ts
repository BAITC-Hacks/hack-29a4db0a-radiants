import { describe, expect, it } from "vitest";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView, SNAPSHOT_DATE } from "../src/lib/recommendation";
import { checkActivityCompletion, previewActivityCompletion, type CompletionContext } from "../src/lib/recommendation/completion";
import type { ActivityStatus, CareerDataset } from "../src/types/career";
import { completionDataset, participation } from "./fixtures/completion-dataset";

const decide = (source: CareerDataset, context?: CompletionContext) =>
  checkActivityCompletion(normalizeDataset(source), source.employees[0]!.employee_id, source.events[0]!.event_id, context);

describe("pure completion policy", () => {
  it("rejects the E0178-shaped unmet prerequisite without mutating skills or history", () => {
    const source = completionDataset();
    source.employees[0]!.skills.SK_SYS = 1;
    const data = normalizeDataset(source);
    const before = structuredClone(data);
    const result = previewActivityCompletion(data, "UNSEEN_PERSON", "UNSEEN_EVENT");
    expect(result).toEqual({ allowed: false, reasons: [{
      code: "prerequisites", message: "Activity prerequisites are not met.",
      missingSkills: [{ skillId: "SK_SYS", current: 1, required: 2 }],
    }] });
    expect(result).not.toHaveProperty("preview");
    expect(data).toEqual(before);
  });

  it("treats a missing prerequisite skill as zero", () => {
    const source = completionDataset();
    source.employees[0]!.skills = {};
    expect(decide(source)).toMatchObject({ allowed: false, reasons: [expect.objectContaining({
      code: "prerequisites", missingSkills: [{ skillId: "SK_SYS", current: 0, required: 2 }],
    })] });
  });

  it.each(["employee", "event"])("returns structured failure for an unknown %s", (kind) => {
    const data = normalizeDataset(completionDataset());
    const result = checkActivityCompletion(data, kind === "employee" ? "missing" : "UNSEEN_PERSON", kind === "event" ? "missing" : "UNSEEN_EVENT");
    expect(result).toMatchObject({ allowed: false, reasons: [{ code: `${kind}_not_found` }] });
  });

  it("allows self-paced empty sessions and a valid activity outside the top three", () => {
    const source = completionDataset();
    const original = source.events[0]!;
    source.events = ["A", "B", "C", "D"].map((event_id) => ({ ...original, event_id }));
    const data = normalizeDataset(source);
    expect(getEmployeeView(data, "UNSEEN_PERSON").recommendations.map((item) => item.eventId)).toEqual(["A", "B", "C"]);
    expect(checkActivityCompletion(data, "UNSEEN_PERSON", "D")).toEqual({ allowed: true, completedAt: SNAPSHOT_DATE });
  });

  it("does not require a career target or target-gap reduction to complete", () => {
    const source = completionDataset();
    source.employees[0]!.grade = "Lead";
    source.events[0]!.target_grades = ["Lead"];
    expect(getEmployeeView(normalizeDataset(source), "UNSEEN_PERSON").recommendations).toEqual([]);
    expect(decide(source)).toMatchObject({ allowed: true });
    source.employees[0]!.grade = "Middle";
    source.employees[0]!.skills.SK_SYS = 5;
    source.events[0]!.target_grades = ["Middle"];
    expect(getEmployeeView(normalizeDataset(source), "UNSEEN_PERSON").recommendations).toEqual([]);
    expect(decide(source)).toMatchObject({ allowed: true });
  });

  it("matches the current or target pair, never a mixed role/grade pair", () => {
    const source = completionDataset();
    source.employees[0]!.career_goal = { target_role: "Data Analyst", target_grade: "Senior" };
    source.events[0]!.target_roles = ["Data Analyst"];
    source.events[0]!.target_grades = ["Middle"];
    expect(decide(source)).toMatchObject({ allowed: false, reasons: [{ code: "audience" }] });
    source.events[0]!.target_grades = ["Senior"];
    expect(decide(source)).toMatchObject({ allowed: true });
  });

  it("uses effective post-review skills, not just the assessment", () => {
    const source = completionDataset();
    source.employees[0]!.skills.SK_SYS = 1;
    source.events.push({ ...source.events[0]!, event_id: "FOUNDATION", prerequisites: {} });
    source.history = [participation({ event_id: "FOUNDATION", status: "completed", completion_pct: 100 })];
    expect(decide(source)).toMatchObject({ allowed: true });
  });

  it("blocks a previously completed event, but permits EV_036 to repeat", () => {
    const source = completionDataset();
    source.history = [participation({ status: "completed", completion_pct: 100 })];
    expect(decide(source)).toMatchObject({ allowed: false, reasons: [{ code: "completed" }] });
    source.events[0]!.event_id = "EV_036";
    source.history[0]!.event_id = "EV_036";
    expect(decide(source)).toEqual({ allowed: true, completedAt: SNAPSHOT_DATE });
  });

  it("allows completion of an active participation excluded from new recommendations", () => {
    const source = completionDataset();
    source.history = [participation()];
    source.events[0]!.format = "offline";
    source.events[0]!.upcoming_sessions = ["2026-09-25"];
    expect(getEmployeeView(normalizeDataset(source), "UNSEEN_PERSON").recommendations).toEqual([]);
    expect(decide(source)).toEqual({ allowed: true, completedAt: SNAPSHOT_DATE, continuingRecordId: "PARTICIPATION" });
  });

  it("does not use an active participation to bypass prerequisites or audience", () => {
    const source = completionDataset();
    source.history = [participation()];
    source.employees[0]!.skills.SK_SYS = 1;
    source.events[0]!.target_roles = ["Product Manager"];
    expect(decide(source)).toMatchObject({ allowed: false, reasons: [
      expect.objectContaining({ code: "audience" }), expect.objectContaining({ code: "prerequisites" }),
    ] });
  });

  it.each(["dropped", "declined", "no_show", "completed"] as ActivityStatus[])("does not revive an in-progress record superseded by %s", (status) => {
    const source = completionDataset();
    source.events[0]!.format = "offline";
    source.history = [participation(), participation({ record_id: "LATER", date: "2026-09-26", status })];
    const result = decide(source);
    expect(result).toMatchObject({ allowed: false, reasons: expect.arrayContaining([expect.objectContaining({ code: "unavailable" })]) });
  });

  it("treats a same-day terminal record conservatively regardless of input order", () => {
    const source = completionDataset();
    source.events[0]!.format = "offline";
    source.history = [participation(), participation({ record_id: "DONE", status: "dropped" })];
    expect(decide(source)).toMatchObject({ allowed: false });
    source.history.reverse();
    expect(decide(source)).toMatchObject({ allowed: false });
  });

  it("does not treat future participation or another employee's record as active", () => {
    const source = completionDataset();
    source.events[0]!.format = "offline";
    source.history = [participation({ date: "2026-10-02" })];
    expect(decide(source)).toMatchObject({ allowed: false });
    source.history = [participation({ employee_id: "ANOTHER_PERSON" })];
    expect(decide(source)).toMatchObject({ allowed: false });
  });

  it.each(["manager", "hr"] as const)("allows assigned mandatory completion from %s, never a recommendation", (assigned_by) => {
    const source = completionDataset();
    source.events[0]!.mandatory = true;
    expect(decide(source)).toMatchObject({ allowed: false, reasons: [{ code: "mandatory_assignment_required" }] });
    source.history = [participation({ assigned_by, status: "overdue" })];
    expect(decide(source)).toMatchObject({ allowed: true, continuingRecordId: "PARTICIPATION" });
    expect(getEmployeeView(normalizeDataset(source), "UNSEEN_PERSON").recommendations).toEqual([]);
  });

  it.each(["self", "wrong_employee", "wrong_event", "declined", "finished"])("rejects untrusted or inactive mandatory assignment: %s", (variant) => {
    const source = completionDataset();
    source.events[0]!.mandatory = true;
    const record = participation({ assigned_by: "manager" });
    if (variant === "self") record.assigned_by = "self";
    if (variant === "wrong_employee") record.employee_id = "ANOTHER_PERSON";
    if (variant === "wrong_event") record.event_id = "ANOTHER_EVENT";
    if (variant === "declined") record.status = "declined";
    if (variant === "finished") record.status = "completed";
    source.history = [record];
    expect(decide(source)).toMatchObject({ allowed: false, reasons: expect.arrayContaining([
      expect.objectContaining({ code: "mandatory_assignment_required" }),
    ]) });
  });

  it("selects the nearest session >= snapshot, without changing the sessions array", () => {
    const source = completionDataset();
    const event = source.events[0]!;
    event.format = "online";
    event.upcoming_sessions = ["2026-10-08", "2026-09-30", "2026-10-01"];
    expect(decide(source)).toEqual({ allowed: true, completedAt: SNAPSHOT_DATE });
    expect(decide(source, { completedAt: "2026-10-08" })).toMatchObject({ allowed: true });
    expect(event.upcoming_sessions).toEqual(["2026-10-08", "2026-09-30", "2026-10-01"]);
  });

  it.each([undefined, "2026-10-05", "2026-09-30"])("cannot invent availability using completedAt=%s", (completedAt) => {
    const source = completionDataset();
    source.events[0]!.format = "online";
    source.events[0]!.upcoming_sessions = ["2026-09-30"];
    expect(decide(source, { completedAt })).toMatchObject({ allowed: false, reasons: expect.arrayContaining([
      expect.objectContaining({ code: "unavailable" }),
    ]) });
  });

  it.each(["2026-10-02", "2026-09-30", "2026-02-30", "not-a-date", "2026-10-01T00:00:00Z"])("rejects arbitrary self-paced completion date %s", (completedAt) => {
    expect(decide(completionDataset(), { completedAt })).toMatchObject({ allowed: false, reasons: [{ code: "invalid_completion_date" }] });
  });
});

describe("single-event completion preview", () => {
  it("previews partial progress with a teaching cap, preserving an already higher level and all inputs", () => {
    const data = normalizeDataset(completionDataset());
    const before = structuredClone(data);
    const result = previewActivityCompletion(data, "UNSEEN_PERSON", "UNSEEN_EVENT");
    expect(result).toMatchObject({ allowed: true, preview: {
      progress: { before: 75, after: 87.5, delta: 12.5 },
      expectedChanges: [
        { skillId: "SK_SYS", before: 2, after: 3, required: 4, critical: true },
        { skillId: "SK_CLOUD", before: 4, after: 4, required: 3, critical: true },
      ],
    } });
    expect(data).toEqual(before);
  });

  it("does not promise growth when completion is already covered by the assessment", () => {
    const source = completionDataset();
    source.employees[0]!.last_review_date = SNAPSHOT_DATE;
    expect(previewActivityCompletion(normalizeDataset(source), "UNSEEN_PERSON", "UNSEEN_EVENT"))
      .toMatchObject({ allowed: true, preview: { progress: { before: 75, after: 75, delta: 0 } } });
  });

  it("replays later history in order instead of adding a gain to the final effective level", () => {
    const source = completionDataset();
    source.employees[0]!.skills.SK_SYS = 1;
    source.events[0]!.prerequisites = {};
    source.events.push({ ...source.events[0]!, event_id: "LATER_COURSE",
      develops_skills: [{ skill_id: "SK_SYS", gain: 2, max_level: 5 }] });
    source.history = [participation({ event_id: "LATER_COURSE", status: "completed", date: "2026-10-10" })];
    const result = previewActivityCompletion(normalizeDataset(source), "UNSEEN_PERSON", "UNSEEN_EVENT");
    // Before: 1 + 2 = 3. Inserted completion first: 1 + 1 + 2 = 4, not capped at 3.
    expect(result).toMatchObject({ allowed: true, preview: { expectedChanges: [
      expect.objectContaining({ skillId: "SK_SYS", before: 3, after: 4 }), expect.anything(),
    ] } });
  });

  it("keeps alternative previews independent, rather than stacking their gains", () => {
    const source = completionDataset();
    source.events.push({ ...source.events[0]!, event_id: "ALTERNATIVE" });
    const data = normalizeDataset(source);
    const first = previewActivityCompletion(data, "UNSEEN_PERSON", "UNSEEN_EVENT");
    const second = previewActivityCompletion(data, "UNSEEN_PERSON", "ALTERNATIVE");
    expect(first).toMatchObject({ preview: { progress: { before: 75, after: 87.5, delta: 12.5 } } });
    expect(second).toMatchObject({ preview: { progress: { before: 75, after: 87.5, delta: 12.5 } } });
    expect(data.history).toEqual([]);
  });

  it("returns skill growth but no invented readiness for a Lead without a target", () => {
    const source = completionDataset();
    source.employees[0]!.grade = "Lead";
    source.events[0]!.target_grades = ["Lead"];
    expect(previewActivityCompletion(normalizeDataset(source), "UNSEEN_PERSON", "UNSEEN_EVENT"))
      .toMatchObject({ allowed: true, preview: { target: null, progress: { before: 0, after: 0, delta: 0 }, effectiveSkills: { SK_SYS: 3 } } });
  });

  it("recalculates preview requirements for a changed career goal", () => {
    const source = completionDataset();
    source.roleProfiles.push({ role: "Product Manager", grade: "Lead", required_skills: { SK_SYS: 5 }, critical_skills: [] });
    source.employees[0]!.career_goal = { target_role: "Product Manager", target_grade: "Lead" };
    expect(previewActivityCompletion(normalizeDataset(source), "UNSEEN_PERSON", "UNSEEN_EVENT"))
      .toMatchObject({ allowed: true, preview: { target: { role: "Product Manager", grade: "Lead" }, progress: { before: 40, after: 60, delta: 20 } } });
  });
});

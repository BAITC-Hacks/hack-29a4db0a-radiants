import { describe, expect, it } from "vitest";
import { normalizeDataset } from "../src/lib/data/normalize";
import {
  calculateReadiness,
  getEmployeeView,
  reconstructEffectiveSkills,
  SNAPSHOT_DATE,
} from "../src/lib/recommendation";
import { applyAiExplanations } from "../src/lib/ai/explanations";
import type {
  ActivityRecord,
  CareerDataset,
  DevelopmentEvent,
  Employee,
  RoleProfile,
  Skill,
} from "../src/types/career";

const employee: Employee = {
  employee_id: "E_TEST",
  full_name: "Test Employee",
  department: "Engineering",
  role: "Backend Engineer",
  grade: "Middle",
  manager_id: null,
  hire_date: "2022-01-01",
  tenure_months: 56,
  work_format: "hybrid",
  preferred_language: "en",
  career_goal: null,
  skills: { SK_SYSTEM_DESIGN: 2, SK_PUBLIC_SPEAKING: 0, SK_PYTHON: 1 },
  last_review_date: "2026-01-01",
};

const profile: RoleProfile = {
  role: "Backend Engineer",
  grade: "Senior",
  required_skills: { SK_SYSTEM_DESIGN: 4, SK_PUBLIC_SPEAKING: 2, SK_PYTHON: 4 },
  critical_skills: ["SK_SYSTEM_DESIGN"],
};

const skills: Skill[] = [
  { skill_id: "SK_SYSTEM_DESIGN", name: "System Design", type: "hard", category: "Engineering", description: "" },
  { skill_id: "SK_PUBLIC_SPEAKING", name: "Public Speaking", type: "soft", category: "Communication", description: "" },
  { skill_id: "SK_PYTHON", name: "Python", type: "hard", category: "Engineering", description: "" },
  { skill_id: "SK_PREREQ", name: "Prerequisite", type: "hard", category: "Engineering", description: "" },
];

function makeEvent(
  eventId: string,
  overrides: Partial<DevelopmentEvent> = {},
): DevelopmentEvent {
  return {
    event_id: eventId,
    title: `Event ${eventId}`,
    description: "Development activity",
    type: "course",
    format: "self_paced",
    duration_hours: 2,
    mandatory: false,
    target_roles: ["Backend Engineer"],
    target_grades: ["Middle", "Senior"],
    develops_skills: [{ skill_id: "SK_SYSTEM_DESIGN", gain: 1, max_level: 5 }],
    prerequisites: {},
    upcoming_sessions: [],
    ...overrides,
  };
}

function makeRecord(
  eventId: string,
  status: ActivityRecord["status"],
  date = "2026-08-01",
  feedback_rating: number | null = null,
): ActivityRecord {
  return {
    record_id: `R_${eventId}_${status}_${date}`,
    employee_id: employee.employee_id,
    event_id: eventId,
    date,
    due_date: null,
    status,
    completion_pct: status === "completed" ? 100 : status === "dropped" ? 50 : 0,
    score: null,
    feedback_rating,
    assigned_by: "self",
  };
}

function makeDataset(
  events: DevelopmentEvent[],
  history: ActivityRecord[] = [],
  employeeOverrides: Partial<Employee> = {},
  roleProfiles: RoleProfile[] = [profile],
): CareerDataset {
  return {
    employees: [{ ...employee, ...employeeOverrides }],
    events,
    skills,
    roleProfiles,
    history,
  };
}

describe("recommendation engine", () => {
  it("uses a fixed snapshot date and resolves the next grade by default", () => {
    const view = getEmployeeView(normalizeDataset(makeDataset([])), employee.employee_id);
    expect(SNAPSHOT_DATE).toBe("2026-10-01");
    expect(view.target).toEqual({ role: "Backend Engineer", grade: "Senior" });
  });

  it("reconstructs post-review completions, treats missing skills as zero, and caps gains", () => {
    const event = makeEvent("EV_GAIN", {
      develops_skills: [
        { skill_id: "SK_PYTHON", gain: 2, max_level: 2 },
        { skill_id: "SK_PREREQ", gain: 4, max_level: 3 },
      ],
    });
    const dataset = normalizeDataset(makeDataset([event], [makeRecord(event.event_id, "completed")]));
    const effective = reconstructEffectiveSkills(employee, dataset);
    expect(effective.SK_PYTHON).toBe(2);
    expect(effective.SK_PREREQ).toBe(3);
  });

  it("prefers a critical target gap over a lower unrelated non-critical gap", () => {
    const critical = makeEvent("EV_CRITICAL", {
      develops_skills: [{ skill_id: "SK_SYSTEM_DESIGN", gain: 2, max_level: 5 }],
    });
    const lowest = makeEvent("EV_LOWEST", {
      develops_skills: [{ skill_id: "SK_PUBLIC_SPEAKING", gain: 2, max_level: 5 }],
      type: "workshop",
    });
    const view = getEmployeeView(normalizeDataset(makeDataset([lowest, critical])), employee.employee_id);
    expect(view.recommendations[0]?.eventId).toBe("EV_CRITICAL");
    expect(view.recommendations[0]?.expectedChanges[0]?.critical).toBe(true);
    expect(view.readiness).toBeGreaterThanOrEqual(0);
    expect(view.readiness).toBeLessThanOrEqual(100);
  });

  it("preserves E0178's above-cap API Design in both preview and completion", () => {
    const event = makeEvent("EV_005", {
      develops_skills: [
        { skill_id: "SK_SYSTEM_DESIGN", gain: 1, max_level: 3 },
        { skill_id: "SK_API_DESIGN", gain: 1, max_level: 3 },
      ],
    });
    const source = makeDataset([event], [], {
      employee_id: "E0178",
      skills: { SK_SYSTEM_DESIGN: 1, SK_API_DESIGN: 4 },
    }, [{
      ...profile,
      required_skills: { SK_SYSTEM_DESIGN: 4, SK_API_DESIGN: 4 },
      critical_skills: ["SK_SYSTEM_DESIGN", "SK_API_DESIGN"],
    }]);
    const before = getEmployeeView(normalizeDataset(source), "E0178");
    expect(before.recommendations[0]?.expectedChanges).toContainEqual({
      skillId: "SK_API_DESIGN", before: 4, after: 4, required: 4, critical: true,
    });
    const after = getEmployeeView(normalizeDataset({
      ...source,
      history: [{ ...makeRecord("EV_005", "completed", SNAPSHOT_DATE), employee_id: "E0178" }],
    }), "E0178");
    expect(after.effectiveSkills).toEqual({ SK_SYSTEM_DESIGN: 2, SK_API_DESIGN: 4 });
    expect(before.readiness).toBe(62.5);
    expect(after.readiness).toBe(75);
    expect(after.recommendations).toEqual([]);
  });

  it("counts partial progress with double weight for critical requirements", () => {
    const event = makeEvent("EV_PARTIAL");
    const source = makeDataset([event]);
    const before = getEmployeeView(normalizeDataset(source), employee.employee_id);
    const after = getEmployeeView(normalizeDataset({
      ...source, history: [makeRecord(event.event_id, "completed", SNAPSHOT_DATE)],
    }), employee.employee_id);
    expect(before.readiness).toBe(31.3);
    expect(after.readiness).toBe(43.8);
    expect(after.skillGaps.find((gap) => gap.skillId === "SK_SYSTEM_DESIGN")?.gap).toBe(1);
  });

  it("caps preview and completed gains from below and gives no credit beyond requirements", () => {
    const event = makeEvent("EV_CAPPED", {
      develops_skills: [{ skill_id: "SK_SYSTEM_DESIGN", gain: 4, max_level: 3 }],
    });
    const source = makeDataset([event]);
    const before = getEmployeeView(normalizeDataset(source), employee.employee_id);
    expect(before.recommendations[0]?.expectedChanges[0]?.after).toBe(3);
    const after = getEmployeeView(normalizeDataset({
      ...source, history: [makeRecord(event.event_id, "completed", SNAPSHOT_DATE)],
    }), employee.employee_id);
    expect(after.effectiveSkills.SK_SYSTEM_DESIGN).toBe(3);
    const complete = getEmployeeView(normalizeDataset(makeDataset([], [], {
      skills: { SK_SYSTEM_DESIGN: 5, SK_PUBLIC_SPEAKING: 5, SK_PYTHON: 5 },
    })), employee.employee_id);
    expect(complete.readiness).toBe(100);
  });

  it("treats zero-level and empty requirements as fully satisfied", () => {
    expect(calculateReadiness([])).toBe(100);
    const view = getEmployeeView(normalizeDataset(makeDataset([], [], { skills: {} }, [{
      ...profile, required_skills: { SK_SYSTEM_DESIGN: 0 },
    }])), employee.employee_id);
    expect(view.readiness).toBe(100);
  });

  it("prioritizes System Design when Public Speaking is lowest and similar sessions were missed", () => {
    const critical = makeEvent("EV_CRITICAL");
    const speaking = makeEvent("EV_SPEAKING", {
      type: "workshop",
      develops_skills: [{ skill_id: "SK_PUBLIC_SPEAKING", gain: 2, max_level: 5 }],
    });
    const missed = makeEvent("EV_MISSED", { ...speaking, event_id: "EV_MISSED", mandatory: true });
    const history = [
      makeRecord(missed.event_id, "no_show", "2026-07-01"),
      makeRecord(missed.event_id, "dropped", "2026-08-01"),
      makeRecord(missed.event_id, "declined", "2026-09-01"),
    ];
    const view = getEmployeeView(normalizeDataset(makeDataset([speaking, critical, missed], history)), employee.employee_id);
    expect(view.recommendations.map((item) => [item.eventId, item.score])).toEqual([
      ["EV_CRITICAL", 40], ["EV_SPEAKING", -10],
    ]);
    expect(view.recommendations[1]?.historySignal).toContain("3 recent participation signal");
  });

  it("excludes mandatory, completed, in-progress, prerequisite-blocked, and unavailable events", () => {
    const events = [
      makeEvent("EV_MANDATORY", { mandatory: true }),
      makeEvent("EV_COMPLETED"),
      makeEvent("EV_PROGRESS"),
      makeEvent("EV_PREREQ", { prerequisites: { SK_PREREQ: 2 } }),
      makeEvent("EV_PAST_SESSION", { format: "online", upcoming_sessions: ["2026-09-30"] }),
      makeEvent("EV_VALID"),
    ];
    const history = [
      makeRecord("EV_COMPLETED", "completed"),
      makeRecord("EV_PROGRESS", "in_progress"),
    ];
    const view = getEmployeeView(normalizeDataset(makeDataset(events, history)), employee.employee_id);
    expect(view.recommendations.map((item) => item.eventId)).toEqual(["EV_VALID"]);
  });

  it("allows EV_036 to repeat and allows self-paced events without sessions", () => {
    const repeatable = makeEvent("EV_036");
    const completed = makeRecord("EV_036", "completed");
    const view = getEmployeeView(
      normalizeDataset(makeDataset([repeatable], [completed])),
      employee.employee_id,
    );
    expect(view.recommendations[0]?.eventId).toBe("EV_036");
    expect(view.recommendations[0]?.nextSession).toBeUndefined();
  });

  it("uses the earliest future scheduled session and ignores past sessions", () => {
    const scheduled = makeEvent("EV_SCHEDULED", {
      format: "online",
      upcoming_sessions: ["2026-11-15", "2026-09-30", "2026-10-20"],
    });
    const view = getEmployeeView(normalizeDataset(makeDataset([scheduled])), employee.employee_id);
    expect(view.recommendations[0]?.nextSession).toBe("2026-10-20");
  });

  it("penalizes recent no-shows for similar event types", () => {
    const candidate = makeEvent("EV_WORKSHOP", { type: "workshop" });
    const historyEvent = makeEvent("EV_OLD_WORKSHOP", { type: "workshop" });
    const baseline = getEmployeeView(
      normalizeDataset(makeDataset([candidate, historyEvent])),
      employee.employee_id,
    );
    const withMissedSession = getEmployeeView(
      normalizeDataset(
        makeDataset([candidate, historyEvent], [makeRecord(historyEvent.event_id, "no_show")]),
      ),
      employee.employee_id,
    );
    expect(withMissedSession.recommendations[0]?.score).toBe(baseline.recommendations[0]?.score! - 10);
    expect(withMissedSession.recommendations[0]?.historySignal).toContain("1 recent participation signal");
  });

  it("uses an explicit career goal and requests one for Lead without a goal", () => {
    const lead: Employee = { ...employee, grade: "Lead", skills: {} };
    const profiles = [profile, { ...profile, grade: "Lead" as const }];
    const noGoalView = getEmployeeView(
      normalizeDataset(makeDataset([], [], lead, profiles)),
      lead.employee_id,
    );
    expect(noGoalView.target).toBeNull();
    expect(noGoalView.targetStatus).toBe("needs_career_goal");
    expect(noGoalView.recommendations).toEqual([]);

    const goalView = getEmployeeView(
      normalizeDataset(
        makeDataset([], [], { career_goal: { target_role: "Backend Engineer", target_grade: "Lead" } }, profiles),
      ),
      employee.employee_id,
    );
    expect(goalView.target?.grade).toBe("Lead");
  });

  it("treats same-format unrelated topics as weak evidence, not an equivalent topic penalty", () => {
    const candidate = makeEvent("CANDIDATE");
    const unrelated = makeEvent("UNRELATED", {
      mandatory: true, develops_skills: [{ skill_id: "SK_PUBLIC_SPEAKING", gain: 1, max_level: 5 }],
    });
    const records = [1, 2, 3].map((day) => makeRecord("UNRELATED", "no_show", "2026-08-0" + day));
    const ranked = getEmployeeView(normalizeDataset(makeDataset([candidate, unrelated], records)), employee.employee_id);
    expect(ranked.recommendations[0]?.score).toBe(34);
    expect(ranked.recommendations[0]?.historySignal).toContain("format-only");
  });

  it("does not promote a topic using feedback about unrelated skills", () => {
    const candidate = makeEvent("CANDIDATE");
    const unrelated = makeEvent("UNRELATED", {
      mandatory: true, develops_skills: [{ skill_id: "SK_PUBLIC_SPEAKING", gain: 1, max_level: 5 }],
    });
    const source = makeDataset([candidate, unrelated], [makeRecord("UNRELATED", "completed", "2025-12-01", 5)]);
    const ranked = getEmployeeView(normalizeDataset(source), employee.employee_id);
    expect(ranked.recommendations[0]?.score).toBe(40);
    expect(ranked.recommendations[0]?.historySignal).not.toContain("Positive feedback");
  });

  it("distinguishes externally assigned declines from self-initiated attendance failures", () => {
    const candidate = makeEvent("CANDIDATE");
    const record = { ...makeRecord("CANDIDATE", "declined"), assigned_by: "manager" as const };
    const ranked = getEmployeeView(normalizeDataset(makeDataset([candidate], [record])), employee.employee_id);
    expect(ranked.recommendations[0]?.score).toBe(35);
    expect(ranked.recommendations[0]?.historySignal).toContain("externally assigned");
  });

  it("reports the actual negative-history count even after the score penalty is capped", () => {
    const candidate = makeEvent("CANDIDATE");
    const records = [1, 2, 3, 4, 5].map((day) => makeRecord("CANDIDATE", "no_show", "2026-08-0" + day));
    const ranked = getEmployeeView(normalizeDataset(makeDataset([candidate], records)), employee.employee_id);
    expect(ranked.recommendations[0]?.score).toBe(10);
    expect(ranked.recommendations[0]?.historySignal).toContain("5 recent participation");
  });

  it("does not interpret missing history as evidence of a positive preference", () => {
    const ranked = getEmployeeView(normalizeDataset(makeDataset([makeEvent("CANDIDATE")])), employee.employee_id);
    expect(ranked.recommendations[0]?.historySignal).toContain("insufficient");
  });

  it("changes an equally useful next step when its relevant participation history changes", () => {
    const early = makeEvent("EV_A", { format: "online", upcoming_sessions: ["2026-10-02"] });
    const alternative = makeEvent("EV_B", { format: "offline", upcoming_sessions: ["2026-10-03"] });
    const baseline = getEmployeeView(normalizeDataset(makeDataset([early, alternative])), employee.employee_id);
    const missed = getEmployeeView(normalizeDataset(makeDataset([early, alternative], [makeRecord("EV_A", "no_show")])), employee.employee_id);
    expect(baseline.recommendations[0]?.eventId).toBe("EV_A");
    expect(missed.recommendations[0]?.eventId).toBe("EV_B");
  });
});

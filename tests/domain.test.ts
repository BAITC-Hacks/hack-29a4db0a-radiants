import { describe, expect, it } from "vitest";
import { DeterministicCareerQuestService } from "@/domain/deterministic-service";
import type { ActivityRecord, DevelopmentEvent, EmployeeDomainInput, RecommendationEnhancer } from "@/contracts/types";
import { enhanceRecommendations } from "@/server/services/recommendation-enhancer";

const service = new DeterministicCareerQuestService();
function event(id: string, overrides: Partial<DevelopmentEvent> = {}): DevelopmentEvent {
  return {
    event_id: id, title: id, description: "Development activity", type: "course",
    format: "self_paced", duration_hours: 2, mandatory: false,
    target_roles: ["Backend Engineer"], target_grades: ["Junior"],
    develops_skills: [{ skill_id: "SK_SYSTEM", gain: 1, max_level: 4 }],
    prerequisites: {}, upcoming_sessions: [], ...overrides,
  };
}
function activity(eventId: string, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    record_id: `record-${eventId}`, employee_id: "HIDDEN_1", event_id: eventId,
    date: "2026-09-20", due_date: null, status: "completed", completion_pct: 100,
    score: null, feedback_rating: null, assigned_by: "self", ...overrides,
  };
}
function input(): EmployeeDomainInput {
  return {
    employee: {
      employee_id: "HIDDEN_1", full_name: "Hidden employee", department: "Engineering",
      role: "Backend Engineer", grade: "Junior", manager_id: null,
      hire_date: "2026-01-01", tenure_months: 9, work_format: "remote", preferred_language: "ru",
      career_goal: null, skills: { SK_SYSTEM: 1 }, last_review_date: "2026-09-01",
    },
    skills: ["SK_SYSTEM", "SK_SPEAKING"].map((id) => ({ skill_id: id, name: id, type: "hard", category: "Test", description: "Test skill" })),
    roleProfiles: [{ role: "Backend Engineer", grade: "Middle", required_skills: { SK_SYSTEM: 4, SK_SPEAKING: 1 }, critical_skills: ["SK_SYSTEM"] }],
    events: [event("SYSTEM"), event("SPEAKING", { develops_skills: [{ skill_id: "SK_SPEAKING", gain: 1, max_level: 4 }] })],
    activities: [],
  };
}

describe("domain contract for arbitrary profiles", () => {
  it("treats missing skills as zero and prioritizes critical target gaps without mutating inputs", () => {
    const data = input();
    const original = structuredClone(data);
    const result = service.recommend(data);
    expect(result.recommendations[0].event.event_id).toBe("SYSTEM");
    expect(result.recommendations[1].evidence.skillImpacts[0].before).toBe(0);
    expect(data).toEqual(original);
  });

  it("applies only post-review completions chronologically and caps gains", () => {
    const data = input();
    data.events[0].develops_skills[0] = { skill_id: "SK_SYSTEM", gain: 3, max_level: 4 };
    data.activities = [
      activity("SYSTEM", { date: "2026-09-01" }),
      activity("SPEAKING", { status: "dropped" }),
      activity("SYSTEM", { record_id: "later" }),
    ];
    const projection = service.buildEmployeeProjection(data);
    expect(projection.effectiveSkills.SK_SYSTEM).toBe(4);
    expect(projection.skillGaps.find((gap) => gap.skillId === "SK_SPEAKING")?.currentLevel).toBe(0);
  });

  it("excludes mandatory, completed, in-progress, blocked and unavailable events", () => {
    const data = input();
    data.events = [
      event("MANDATORY", { mandatory: true }),
      event("DONE"), event("ACTIVE"),
      event("BLOCKED", { prerequisites: { SK_SPEAKING: 1 } }),
      event("EXPIRED", { format: "online", upcoming_sessions: ["2026-09-30"] }),
      event("WRONG_ROLE", { target_roles: ["Data Analyst"] }),
      event("WRONG_GRADE", { target_grades: ["Lead"] }),
      event("AVAILABLE"),
    ];
    data.activities = [activity("DONE", { date: "2026-08-01" }), activity("ACTIVE", { status: "in_progress" })];
    expect(service.recommend(data).recommendations.map((item) => item.event.event_id)).toEqual(["AVAILABLE"]);
    expect(service.recommend(data).recommendations[0].availability.kind).toBe("self_paced");
  });

  it("allows EV_036 after a previous completion and uses the snapshot for sessions", () => {
    const data = input();
    data.events = [event("EV_036", { format: "offline", upcoming_sessions: ["2026-10-22", "2026-09-24", "2026-10-08"] })];
    data.activities = [activity("EV_036", { date: "2026-08-01" })];
    expect(service.recommend(data).recommendations[0].availability.nextSession).toBe("2026-10-08");
  });

  it("returns a valid empty result for a Lead without a target", () => {
    const data = input();
    data.employee.grade = "Lead";
    expect(service.buildEmployeeProjection(data)).toMatchObject({ targetStatus: "no_target", readiness: null });
    expect(service.recommend(data)).toMatchObject({ recommendations: [], emptyReason: "no_target" });
  });

  it("reduces suitability after repeated missed similar events", () => {
    const data = input();
    const before = service.recommend(data).recommendations[0].score;
    data.activities = [1, 2, 3].map((id) => activity("SYSTEM", { record_id: `miss-${id}`, status: "no_show", completion_pct: 0 }));
    const after = service.recommend(data).recommendations[0];
    expect(after.score).toBeLessThan(before);
    expect(after.evidence.historySignals[0]).toContain("subtract");
  });
});

describe("enhancer boundary", () => {
  it("accepts reordering while preserving deterministic evidence", async () => {
    const data = input();
    const result = service.recommend(data);
    const enhancer: RecommendationEnhancer = { enhance: async (value) => ({ ...value, recommendations: value.recommendations.reverse(), source: "ai_enhanced" }) };
    const output = await enhanceRecommendations(enhancer, result, data);
    expect(output.source).toBe("ai_enhanced");
    expect(output.recommendations[0]).toEqual(result.recommendations[1]);
  });

  it.each(["event", "impact", "explanation", "duplicate", "malformed", "failure", "timeout"])("falls back for %s", async (kind) => {
    const data = input();
    const result = service.recommend(data);
    const original = structuredClone(result);
    const enhancer: RecommendationEnhancer = {
      enhance: async (value) => {
        if (kind === "failure") throw new Error("Provider unavailable");
        if (kind === "timeout") return new Promise(() => {});
        if (kind === "malformed") return null as never;
        if (kind === "event") value.recommendations[0].event.event_id = "INVENTED";
        if (kind === "impact") value.recommendations[0].evidence.skillImpacts[0].after = 5;
        if (kind === "explanation") value.recommendations[0].explanation = "You are guaranteed a promotion";
        if (kind === "duplicate") value.recommendations[1] = value.recommendations[0];
        return value;
      },
    };
    expect(await enhanceRecommendations(enhancer, result, data, 10)).toEqual(original);
    expect(result).toEqual(original);
  });
});

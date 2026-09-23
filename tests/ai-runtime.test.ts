import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { AI_REQUEST_BUDGET_MS, completeActivity, getEmployeeProjection, getRecommendations } from "@/server/services/career-quest";
import { GET as recommendationsRoute } from "@/app/api/employees/[employeeId]/recommendations/route";
import type { RecommendationExplainer } from "@/lib/ai/explanations";
import { GET as profileRoute } from "@/app/api/employees/[employeeId]/route";
import { authHeaders, testIdentity, type TestIdentity } from "./helpers/auth";

let directory: string;
let identity: TestIdentity;
beforeEach(async () => {
  closeDatabase();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-ai-runtime-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "test.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  identity = await testIdentity();
});
afterEach(() => {
  vi.useRealTimers();
  closeDatabase();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});

const grounded: RecommendationExplainer = {
  explain: async ({ recommendations }) => recommendations.map((rec) => ({
    eventId: rec.eventId, explanation: "Model explanation for " + rec.eventId,
    evidenceRefs: ["target", "history", rec.allowedEvidenceRefs.find((ref) => ref.startsWith("skill:"))!],
  })),
};

describe("AI on the persisted official dataset", () => {
  it("enriches only recommendation text and preserves completed history", async () => {
    const before = getEmployeeProjection("E0178");
    const after = await getRecommendations("E0178", getDatabase(), grounded);
    expect(after.completedActivities.length).toBeGreaterThan(0);
    expect(after).toEqual({ ...before, recommendations: before.recommendations.map((rec) => ({
      ...rec, aiExplanation: "Model explanation for " + rec.eventId, explanationSource: "llm",
    })) });
    expect(databaseCounts().activityHistory).toBe(2743);
  });

  it("reads fresh persisted skills after completion without persisting generated text", async () => {
    await completeActivity("E0178", "EV_005", {});
    const after = await getRecommendations("E0178", getDatabase(), grounded);
    expect(after.readiness).toBe(74.1);
    expect(after.effectiveSkills.SK_API_DESIGN).toBe(4);
    expect(after.recommendations.some((rec) => rec.eventId === "EV_005")).toBe(false);
    expect(after.completedActivities.some((record) => record.event_id === "EV_005")).toBe(true);
    expect(getEmployeeProjection("E0178").recommendations.every((rec) => rec.explanationSource === "fallback")).toBe(true);
    expect(databaseCounts().activityHistory).toBe(2744);
  });

  it("does not contact OpenAI when the server key is missing", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await getRecommendations("E0178")).toEqual(getEmployeeProjection("E0178"));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns the existing HTTP envelope with server-side AI enabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const evidence = JSON.parse(body.input[1].content);
      expect(evidence).not.toHaveProperty("employee");
      return new Response(JSON.stringify({
        status: "completed", output: [{ type: "message", content: [{
          type: "output_text", text: JSON.stringify({ recommendations: await grounded.explain(evidence) }),
        }] }],
      }));
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await recommendationsRoute(new Request("http://localhost/api/employees/E0178/recommendations", { headers: authHeaders(identity) }),
      { params: Promise.resolve({ employeeId: "E0178" }) });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result.data.completedActivities.length).toBeGreaterThan(0);
    expect(result.data.recommendations.every((rec: { explanationSource: string }) => rec.explanationSource === "llm")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns deterministic HTTP data on an OpenAI failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
    const response = await recommendationsRoute(new Request("http://localhost", { headers: authHeaders(identity) }), { params: Promise.resolve({ employeeId: "E0178" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(getEmployeeProjection("E0178"));
  });

  it("keeps profile and completion independent of a hung AI request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const response = await profileRoute(new Request("http://localhost", { headers: authHeaders(identity) }), { params: Promise.resolve({ employeeId: "E0178" }) });
    expect(response.status).toBe(200);
    const completed = await completeActivity("E0178", "EV_005", {});
    expect(completed.view.readiness).toBe(74.1);
    expect(completed.view.recommendations.every((rec) => rec.explanationSource === "fallback")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns 404 without invoking the provider for an unknown employee", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await recommendationsRoute(new Request("http://localhost", { headers: authHeaders(identity) }), { params: Promise.resolve({ employeeId: "MISSING" }) });
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not invoke the provider for an employee without a target", async () => {
    const row = getDatabase().prepare("SELECT employee_id FROM employees WHERE grade = 'Lead' AND career_goal_json IS NULL LIMIT 1").get() as { employee_id: string };
    const explain = vi.fn();
    const result = await getRecommendations(row.employee_id, getDatabase(), { explain });
    expect(result.targetStatus).toBe("needs_career_goal");
    expect(result.recommendations).toEqual([]);
    expect(explain).not.toHaveBeenCalled();
  });

  it("aborts the real transport at 8 seconds and returns HTTP fallback", async () => {
    const baseline = getEmployeeProjection("E0178");
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal;
      return new Promise(() => {});
    }));
    const response = recommendationsRoute(new Request("http://localhost", { headers: authHeaders(identity) }), { params: Promise.resolve({ employeeId: "E0178" }) });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(signal?.aborted).toBe(true);
    expect((await (await response).json()).data).toEqual(baseline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a custom hanging explainer by the full request budget and ignores late results", async () => {
    const baseline = getEmployeeProjection("E0178");
    vi.useFakeTimers();
    let finish!: (value: Awaited<ReturnType<RecommendationExplainer['explain']>>) => void;
    const pending = getRecommendations("E0178", getDatabase(), {
      explain: () => new Promise((resolve) => { finish = resolve; }),
    });
    await vi.advanceTimersByTimeAsync(AI_REQUEST_BUDGET_MS);
    const fallback = await pending;
    expect(fallback).toEqual(baseline);
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toEqual(baseline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips AI after the request budget has already expired", async () => {
    const explain = vi.fn();
    expect(await getRecommendations("E0178", getDatabase(), { explain }, performance.now() - 1)).toEqual(getEmployeeProjection("E0178"));
    expect(explain).not.toHaveBeenCalled();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { completeActivity, getEmployeeProjection, getRecommendations } from "@/server/services/career-quest";
import { GET as recommendationsRoute } from "@/app/api/employees/[employeeId]/recommendations/route";
import type { RecommendationExplainer } from "@/lib/ai/explanations";

let directory: string;
beforeEach(() => {
  closeDatabase();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-ai-runtime-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "test.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterEach(() => {
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
    const response = await recommendationsRoute(new Request("http://localhost/api/employees/E0178/recommendations"),
      { params: Promise.resolve({ employeeId: "E0178" }) });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data.completedActivities.length).toBeGreaterThan(0);
    expect(result.data.recommendations.every((rec: { explanationSource: string }) => rec.explanationSource === "llm")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns deterministic HTTP data on an OpenAI failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
    const response = await recommendationsRoute(new Request("http://localhost"), { params: Promise.resolve({ employeeId: "E0178" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(getEmployeeProjection("E0178"));
  });
});

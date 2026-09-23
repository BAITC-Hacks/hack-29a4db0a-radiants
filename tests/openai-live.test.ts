import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { expect, it } from "vitest";
import type { RecommendationExplainer } from "../src/lib/ai/explanations";
import { createOpenAIExplainer } from "../src/lib/ai/openai-explainer";
import { closeDatabase, getDatabase } from "../src/server/db/database";
import { getEmployeeProjection, getRecommendations } from "../src/server/services/career-quest";

const enabled = process.env.npm_lifecycle_event === "test:ai-live" || process.env.RUN_OPENAI_SMOKE === "1";

it.runIf(enabled).each(["E0178", "E0058"])("gets a real explanation from the SQLite service for %s", async (employeeId) => {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  if (existsSync(".env")) loadEnvFile(".env");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Live check requires server-side OPENAI_API_KEY in the environment, .env.local or .env; no request was sent.");
  const directory = mkdtempSync(path.join(os.tmpdir(), "career-live-ai-"));
  const previousPath = process.env.CAREER_QUEST_DB_PATH;
  const previousData = process.env.CAREER_QUEST_DATA_DIR;
  closeDatabase();
  process.env.CAREER_QUEST_DB_PATH = path.join(directory, "live.sqlite");
  process.env.CAREER_QUEST_DATA_DIR = path.resolve("data");
  try {
  const baseline = getEmployeeProjection(employeeId);
  expect(baseline.recommendations.length).toBeGreaterThan(0);
  const transport = createOpenAIExplainer({ apiKey, model: process.env.OPENAI_MODEL || undefined });
  let failure = "No explanations passed evidence validation";
  const explainer: RecommendationExplainer = {
    async explain(input) {
      try {
        return await transport.explain(input);
      } catch (error) {
        failure = error instanceof Error ? error.message : "Transport failed";
        throw error;
      }
    },
  };
  const start = performance.now();
  const result = await getRecommendations(employeeId, getDatabase(), explainer);
  if (result.recommendations.some((rec) => rec.explanationSource !== "llm")) {
    throw new Error(`Live AI check used fallback: ${failure}`);
  }
  expect(performance.now() - start).toBeLessThan(10_000);
  result.recommendations.forEach((rec, index) => {
    expect(rec.aiExplanation?.trim().length).toBeGreaterThan(0);
    expect(rec).toEqual({ ...baseline.recommendations[index],
      explanationSource: "llm", aiExplanation: rec.aiExplanation,
    });
  });
  expect(result.completedActivities).toEqual(baseline.completedActivities);
  console.info(JSON.stringify({ employeeId, elapsedMs: Math.round(performance.now() - start),
    explanations: result.recommendations.map((rec) => ({ eventId: rec.eventId, source: rec.explanationSource, explanation: rec.aiExplanation })) }));
  } finally {
    closeDatabase();
    if (previousPath === undefined) delete process.env.CAREER_QUEST_DB_PATH;
    else process.env.CAREER_QUEST_DB_PATH = previousPath;
    if (previousData === undefined) delete process.env.CAREER_QUEST_DATA_DIR;
    else process.env.CAREER_QUEST_DATA_DIR = previousData;
    rmSync(directory, { recursive: true, force: true });
  }
}, 12_000);

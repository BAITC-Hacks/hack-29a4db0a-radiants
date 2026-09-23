import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { expect, it } from "vitest";
import { getEmployeeViewWithAi, type RecommendationExplainer } from "../src/lib/ai/explanations";
import { createOpenAIExplainer } from "../src/lib/ai/openai-explainer";
import { normalizeDataset } from "../src/lib/data/normalize";
import { demoDataset } from "./fixtures/career-dataset";
import { getEmployeeView } from "../src/lib/recommendation";

const enabled = process.env.npm_lifecycle_event === "test:ai-live" || process.env.RUN_OPENAI_SMOKE === "1";

it.runIf(enabled)("gets a real structured explanation without changing deterministic recommendations", async () => {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Live check requires server-side OPENAI_API_KEY in the environment or .env.local; no request was sent.");
  const data = normalizeDataset(structuredClone(demoDataset));
  const employeeId = "EMP-014";
  const baseline = getEmployeeView(data, employeeId);
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
  const result = await getEmployeeViewWithAi(data, employeeId, explainer);
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
}, 12_000);

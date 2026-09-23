import { expect, it } from "vitest";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import { applyAiExplanations } from "../src/lib/ai/explanations";
import { officialAiDataset } from "./fixtures/official-ai-dataset";

it("evaluates explanation boundaries for every official profile without paid calls", async () => {
  const source = officialAiDataset();
  const data = normalizeDataset(source);
  const original = structuredClone(data);
  let explained = 0;
  let batches = 0;
  const languages = new Set<string>();
  for (const employee of source.employees) {
    const baseline = getEmployeeView(data, employee.employee_id);
    const result = await applyAiExplanations(baseline, { explain: async (input) => {
      batches++;
      languages.add(input.language!);
      expect(input.language).toBe(employee.preferred_language);
      expect(input.target).toEqual(baseline.target);
      const serialized = JSON.stringify(input);
      expect(serialized).not.toContain(employee.full_name);
      expect(serialized).not.toContain(employee.employee_id);
      expect(input).not.toHaveProperty("history");
      return input.recommendations.map((rec) => ({
        eventId: rec.eventId,
        explanation: baseline.recommendations.find((item) => item.eventId === rec.eventId)!.deterministicExplanation,
        evidenceRefs: ["target", "history", rec.allowedEvidenceRefs.find((ref) => ref.startsWith("skill:"))!],
      }));
    } });
    expect(result).toEqual({ ...baseline, recommendations: baseline.recommendations.map((rec) => ({
      ...rec, aiExplanation: rec.deterministicExplanation, explanationSource: "llm",
    })) });
    explained += result.recommendations.length;
  }
  expect(data).toEqual(original);
  expect(batches).toBe(173);
  expect(explained).toBe(438);
  console.info(JSON.stringify({ mode: "offline-contract-evaluation-not-live-ai", profiles: 200, batches, explained, languages: [...languages].sort() }));
});

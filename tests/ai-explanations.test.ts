import { describe, expect, it } from "vitest";
import { applyAiExplanations, validateAiExplanations } from "../src/lib/ai/explanations";
import { createOpenAIExplainer } from "../src/lib/ai/openai-explainer";
import type { EmployeeView, Recommendation } from "../src/types/career";

const recommendation: Recommendation = {
  eventId: "EV_001",
  title: "System Design Workshop",
  score: 80,
  reasons: ["Critical skill gap"],
  expectedChanges: [{ skillId: "SK_SYSTEM_DESIGN", before: 2, after: 3, required: 4, critical: true }],
  historySignal: "No recent negative participation signal.",
  deterministicExplanation: "This activity advances the target trajectory.",
  explanationSource: "fallback",
};

const view: EmployeeView = {
  employee: {
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
    skills: {},
    last_review_date: "2026-01-01",
  },
  target: { role: "Backend Engineer", grade: "Senior" },
  targetStatus: "active",
  effectiveSkills: {},
  readiness: 50,
  skillGaps: [],
  recommendations: [recommendation],
};

describe("AI recommendation explanations", () => {
  it("rejects unknown events and explanations with fewer than three valid evidence refs", () => {
    const allowed = new Map([["EV_001", ["target", "history", "availability", "skill:SK_SYSTEM_DESIGN"]]]);
    const accepted = validateAiExplanations(
      [
        { eventId: "EV_UNKNOWN", explanation: "Invented", evidenceRefs: ["target", "history", "availability"] },
        { eventId: "EV_001", explanation: "Too little evidence", evidenceRefs: ["target", "history"] },
        {
          eventId: "EV_001",
          explanation: "Grounded explanation",
          evidenceRefs: ["target", "history", "skill:SK_SYSTEM_DESIGN"],
        },
      ],
      allowed,
    );
    expect(accepted.size).toBe(1);
    expect(accepted.get("EV_001")).toBe("Grounded explanation");
  });

  it("uses valid AI text and falls back when the explainer fails", async () => {
    const aiView = await applyAiExplanations(view, {
      explain: async () => [
        {
          eventId: "EV_001",
          explanation: "Builds a critical promotion skill.",
          evidenceRefs: ["target", "history", "skill:SK_SYSTEM_DESIGN"],
        },
      ],
    });
    expect(aiView.recommendations[0]?.explanationSource).toBe("llm");

    const fallbackView = await applyAiExplanations(view, {
      explain: async () => {
        throw new Error("timeout");
      },
    });
    expect(fallbackView.recommendations[0]?.explanationSource).toBe("fallback");
    expect(fallbackView.recommendations[0]?.deterministicExplanation).toBe(
      recommendation.deterministicExplanation,
    );
  });

  it("calls the Responses API with strict JSON Schema output", async () => {
    let requestBody = "";
    const explainer = createOpenAIExplainer({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              recommendations: [
                {
                  eventId: "EV_001",
                  explanation: "Evidence based.",
                  evidenceRefs: ["target", "history", "availability"],
                },
              ],
            }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const result = await explainer.explain({
      target: view.target,
      recommendations: [{ ...recommendation, allowedEvidenceRefs: ["target", "history", "availability"] }],
    });

    expect(result[0]?.eventId).toBe("EV_001");
    expect(requestBody).toContain('"type":"json_schema"');
    expect(requestBody).toContain('"strict":true');
  });
});

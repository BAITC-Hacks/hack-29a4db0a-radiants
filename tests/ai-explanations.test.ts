import { afterEach, describe, expect, it, vi } from "vitest";
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
  deterministicExplanation: "Занятие поможет развить навык для вашей цели.",
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
  afterEach(() => vi.useRealTimers());
  it("rejects unknown events and explanations with fewer than three valid evidence refs", () => {
    const refs = ["target", "history", "availability", "skill:SK_SYSTEM_DESIGN"];
    const allowed = new Map([["EV_001", refs], ["EV_TOO_LITTLE", refs]]);
    const accepted = validateAiExplanations(
      [
        { eventId: "EV_UNKNOWN", explanation: "Invented", evidenceRefs: ["target", "history", "availability"] },
        { eventId: "EV_TOO_LITTLE", explanation: "Too little evidence", evidenceRefs: ["target", "history"] },
        {
          eventId: "EV_001",
          explanation: "Занятие поможет развить навык для вашей цели.",
          evidenceRefs: ["target", "history", "skill:SK_SYSTEM_DESIGN"],
        },
      ],
      allowed,
    );
    expect(accepted.size).toBe(1);
    expect(accepted.get("EV_001")).toBe("Занятие поможет развить навык для вашей цели.");
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
            status: "completed",
            output_text: JSON.stringify({
              recommendations: [
                {
                  eventId: "EV_001",
                  explanation: "Занятие поможет развить навык для вашей цели.",
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
    const systemPrompt = JSON.parse(requestBody).input[0].content;
    expect(systemPrompt).toContain("простым русским языком");
    expect(systemPrompt).toContain("всегда пиши по-русски");
    expect(systemPrompt).toContain("ожидаемым результатом после завершения");
  });

  it.each([
    "Advanced Python supports the Middle Backend Engineer target by raising Python from 2 to 3. There are no comparable participation records.",
    "Да. Advanced Python supports the Middle Backend Engineer target by raising Python from 2 to 3. There are no comparable participation records.",
    "Курс цель навык рост уровень опыт. This activity supports the target by improving a critical skill and meeting the required level. There are no comparable participation records, so evidence is insufficient to infer a preference.",
  ])("uses the Russian fallback for English prose, including token Russian padding (%#)", async (explanation) => {
    const result = await withPayload({ status: "completed", output_text: JSON.stringify({
      recommendations: [{ eventId: "EV_001", explanation, evidenceRefs: ["target", "history", "skill:SK_SYSTEM_DESIGN"] }],
    }) });
    expect(result).toEqual(view);
    expect(result.recommendations[0]?.explanationSource).toBe("fallback");
    expect(result.recommendations[0]?.aiExplanation).toBeUndefined();
    expect(result.recommendations[0]?.deterministicExplanation).toContain("Занятие поможет");
  });

  it("accepts Russian prose with official English catalog names", async () => {
    const explanation = "System Design Workshop поможет подготовиться к роли Backend Engineer уровня Senior: ожидаемый уровень навыка вырастет с 2 до 3, для цели нужен 4. Пока недостаточно данных, чтобы понять, подходит ли вам этот формат.";
    const result = await withPayload({ status: "completed", output_text: JSON.stringify({
      recommendations: [{ eventId: "EV_001", explanation, evidenceRefs: ["target", "history", "skill:SK_SYSTEM_DESIGN"] }],
    }) });
    expect(result.recommendations[0]?.explanationSource).toBe("llm");
    expect(result.recommendations[0]?.aiExplanation).toBe(explanation);
  });

  it.each([undefined, "", "   "])("does not send a request when the API key is empty", async (apiKey) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await applyAiExplanations(view, createOpenAIExplainer({ apiKey, fetchImpl }));
    expect(result).toEqual(view);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["incomplete", "failed", "cancelled", "in_progress"])("falls back for response status %s even if text looks valid", async (status) => {
    const result = await withPayload({ status, output_text: validText() });
    expect(result).toEqual(view);
  });

  it("reads a REST message after a reasoning item and preserves deterministic fields", async () => {
    const result = await withPayload({ status: "completed", output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: validText() }] },
    ] });
    expect(result).toEqual({ ...view, recommendations: [{
      ...recommendation, aiExplanation: "Занятие поможет развить навык для вашей цели.", explanationSource: "llm",
    }] });
    expect(view.recommendations[0]?.explanationSource).toBe("fallback");
  });

  it.each([
    null,
    { output_text: validText() },
    { status: "completed", output: [] },
    { status: "completed", output_text: "{broken" },
    { status: "completed", output_text: JSON.stringify({ ...JSON.parse(validText()), extra: true }) },
    { status: "completed", output_text: JSON.stringify({ recommendations: [{ ...JSON.parse(validText()).recommendations[0], score: 999 }] }) },
    { status: "completed", output_text: JSON.stringify({ recommendations: [null] }) },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Refused" }] }], output_text: validText() },
  ])("uses fallback for malformed output or refusal (%#)", async (payload) => {
    expect(await withPayload(payload)).toEqual(view);
  });

  it.each([401, 429, 500])("uses fallback for HTTP %s without retrying", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("Request failed", { status }));
    expect(await applyAiExplanations(view, createOpenAIExplainer({ apiKey: "test", fetchImpl }))).toEqual(view);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["headers", "body"])("enforces the deadline when %s never resolves, even if the transport ignores abort", async (stage) => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      signal = init?.signal;
      if (stage === "headers") return new Promise<Response>(() => {});
      const response = new Response();
      vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {}));
      return response;
    };
    let settled = false;
    const pending = applyAiExplanations(view, createOpenAIExplainer({ apiKey: "test", timeoutMs: 25, fetchImpl }))
      .then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(25);
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(true);
    expect(await pending).toEqual(view);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not call AI when there are no recommendations", async () => {
    const explain = vi.fn();
    const empty = { ...view, recommendations: [] };
    expect(await applyAiExplanations(empty, { explain })).toBe(empty);
    expect(explain).not.toHaveBeenCalled();
  });

  it("clears the deadline after success and leaves fallback intact when a timed-out request finishes late", async () => {
    vi.useFakeTimers();
    await withPayload({ status: "completed", output_text: validText() });
    expect(vi.getTimerCount()).toBe(0);
    let finish!: (response: Response) => void;
    const pending = applyAiExplanations(view, createOpenAIExplainer({
      apiKey: "test", timeoutMs: 25,
      fetchImpl: () => new Promise<Response>((resolve) => { finish = resolve; }),
    }));
    await vi.advanceTimersByTimeAsync(25);
    const fallback = await pending;
    finish(new Response(JSON.stringify({ status: "completed", output_text: validText() })));
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toEqual(view);
    expect(fallback.recommendations[0]?.explanationSource).toBe("fallback");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores event substitution, unknown evidence, repeated refs, and empty text", async () => {
    for (const item of [
      { eventId: "OTHER", explanation: "Invented", evidenceRefs: ["target", "history", "availability"] },
      { eventId: "EV_001", explanation: "Invented", evidenceRefs: ["target", "history", "skill:UNKNOWN"] },
      { eventId: "EV_001", explanation: "Repeated", evidenceRefs: ["target", "target", "history"] },
      { eventId: "EV_001", explanation: " ", evidenceRefs: ["target", "history", "availability"] },
    ]) {
      expect(await withPayload({ status: "completed", output_text: JSON.stringify({ recommendations: [item] }) })).toEqual(view);
    }
  });

  it.each([
    ["target", "history", "availability"],
    ["target", "availability", "skill:SK_SYSTEM_DESIGN"],
    ["history", "availability", "skill:SK_SYSTEM_DESIGN"],
  ])("requires target, history and a skill gap, not any three labels (%j)", async (...refs) => {
    expect(await withPayload({ status: "completed", output_text: JSON.stringify({
      recommendations: [{ eventId: "EV_001", explanation: "Missing a required factor", evidenceRefs: refs }],
    }) })).toEqual(view);
  });

  it("does not allow an irrelevant or unchanged skill to count as gap evidence", async () => {
    const explain = vi.fn<Parameters<typeof applyAiExplanations>[1]["explain"]>()
      .mockResolvedValue([{ eventId: "EV_001", explanation: "Unrelated", evidenceRefs: ["target", "history", "skill:OTHER"] }]);
    const input = { ...view, recommendations: [{ ...recommendation, expectedChanges: [
      ...recommendation.expectedChanges,
      { skillId: "OTHER", before: 4, after: 4, required: 2, critical: false },
    ] }] };
    expect(await applyAiExplanations(input, { explain })).toEqual(input);
    expect(explain.mock.calls[0]?.[0].recommendations[0]?.allowedEvidenceRefs).not.toContain("skill:OTHER");
  });

  it("rejects ambiguous duplicate event explanations", async () => {
    const item = JSON.parse(validText()).recommendations[0];
    expect(await withPayload({ status: "completed", output_text: JSON.stringify({
      recommendations: [item, { ...item, explanation: "Conflicting explanation" }],
    }) })).toEqual(view);
  });
});

function validText(): string {
  return JSON.stringify({ recommendations: [{ eventId: "EV_001", explanation: "Занятие поможет развить навык для вашей цели.", evidenceRefs: ["target", "history", "skill:SK_SYSTEM_DESIGN"] }] });
}

async function withPayload(payload: unknown): Promise<EmployeeView> {
  return applyAiExplanations(view, createOpenAIExplainer({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }),
  }));
}

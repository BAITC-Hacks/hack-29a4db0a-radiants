import type { EmployeeDetail } from "../contracts/api";

/** Include every deterministic field; AI responses cannot replace profile or progress data. */
function deterministicSnapshot(view: EmployeeDetail): string {
  return JSON.stringify({
    ...view,
    recommendations: view.recommendations.map((recommendation) => {
      const { aiExplanation: _text, explanationSource: _source, ...evidence } = recommendation;
      void _text;
      void _source;
      return evidence;
    }),
  });
}

export function mergeAiExplanations(current: EmployeeDetail, incoming: EmployeeDetail): EmployeeDetail | null {
  if (deterministicSnapshot(current) !== deterministicSnapshot(incoming)) return null;
  return {
    ...current,
    recommendations: current.recommendations.map((recommendation, index) => {
      const explanation = incoming.recommendations[index]!;
      return explanation.explanationSource === "llm" && explanation.aiExplanation?.trim()
        ? { ...recommendation, aiExplanation: explanation.aiExplanation, explanationSource: "llm" }
        : recommendation;
    }),
  };
}

/** Cancellation is checked even when a transport ignores AbortSignal or resolves after abort. */
export function createAiRecommendationRequest() {
  let active: AbortController | undefined;
  return {
    cancel() {
      active?.abort();
      active = undefined;
    },
    async run(
      baseline: EmployeeDetail,
      load: (employeeId: string, signal: AbortSignal) => Promise<EmployeeDetail>,
      onResult: (view: EmployeeDetail | null) => void,
      onFailure: () => void,
    ): Promise<void> {
      active?.abort();
      const request = new AbortController();
      active = request;
      try {
        const incoming = await load(baseline.employee.employee_id, request.signal);
        if (active === request && !request.signal.aborted) onResult(mergeAiExplanations(baseline, incoming));
      } catch {
        if (active === request && !request.signal.aborted) onFailure();
      }
    },
  };
}

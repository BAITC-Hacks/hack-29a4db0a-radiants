import type { EmployeeView, Recommendation } from "../../types/career";
import { getEmployeeView } from "../recommendation";
import type { NormalizedDataset } from "../data/normalize";

export interface AiExplanation {
  eventId: string;
  explanation: string;
  evidenceRefs: string[];
}

export interface RecommendationExplainer {
  explain(input: {
    target: EmployeeView["target"];
    recommendations: Array<Recommendation & { allowedEvidenceRefs: string[] }>;
  }): Promise<AiExplanation[]>;
}

export async function getEmployeeViewWithAi(
  dataset: NormalizedDataset,
  employeeId: string,
  explainer: RecommendationExplainer,
): Promise<EmployeeView> {
  return applyAiExplanations(getEmployeeView(dataset, employeeId), explainer);
}

export async function applyAiExplanations(
  view: EmployeeView,
  explainer: RecommendationExplainer,
): Promise<EmployeeView> {
  if (view.recommendations.length === 0) {
    return view;
  }

  try {
    const allowedRefsByEvent = new Map(
      view.recommendations.map((recommendation) => [
        recommendation.eventId,
        allowedEvidenceRefs(recommendation),
      ]),
    );
    const explanations = await explainer.explain({
      target: view.target,
      recommendations: view.recommendations.map((recommendation) => ({
        ...recommendation,
        allowedEvidenceRefs: allowedRefsByEvent.get(recommendation.eventId) ?? [],
      })),
    });
    const validated = validateAiExplanations(explanations, allowedRefsByEvent);

    return {
      ...view,
      recommendations: view.recommendations.map((recommendation) => {
        const explanation = validated.get(recommendation.eventId);
        return explanation
          ? { ...recommendation, aiExplanation: explanation, explanationSource: "llm" }
          : recommendation;
      }),
    };
  } catch {
    return view;
  }
}

export function validateAiExplanations(
  explanations: AiExplanation[],
  allowedRefsByEvent: Map<string, string[]>,
): Map<string, string> {
  const accepted = new Map<string, string>();
  for (const explanation of explanations) {
    const allowedRefs = allowedRefsByEvent.get(explanation.eventId);
    const uniqueRefs = new Set(explanation.evidenceRefs);
    if (
      !allowedRefs ||
      accepted.has(explanation.eventId) ||
      typeof explanation.explanation !== "string" ||
      !explanation.explanation.trim() ||
      uniqueRefs.size < 3 ||
      [...uniqueRefs].some((ref) => !allowedRefs.includes(ref))
    ) {
      continue;
    }
    accepted.set(explanation.eventId, explanation.explanation.trim());
  }
  return accepted;
}

function allowedEvidenceRefs(recommendation: Recommendation): string[] {
  return [
    "target",
    "history",
    "availability",
    ...recommendation.expectedChanges.map((change) => `skill:${change.skillId}`),
  ];
}

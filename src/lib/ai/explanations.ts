import type { EmployeeView, Recommendation } from "../../types/career";
import { getEmployeeView } from "../recommendation";
import type { NormalizedDataset } from "../data/normalize";
import { containsRequiredFacts, hasUnsupportedClaims } from "./text-checks";

export interface AiExplanation {
  eventId: string;
  explanation: string;
  evidenceRefs: string[];
}

export interface ExplanationInput {
  language?: "en" | "ru" | "kk";
  target: EmployeeView["target"];
  recommendations: Array<Pick<Recommendation, "eventId" | "title" | "expectedChanges" | "historySignal" | "nextSession"> & {
    allowedEvidenceRefs: string[];
    skillNames?: Record<string, string>;
  }>;
}

export interface RecommendationExplainer {
  explain(input: ExplanationInput): Promise<AiExplanation[]>;
}

/** Explicit projection prevents internal metadata or an old AI answer entering a new prompt. */
export function copyExplanationInput(input: ExplanationInput): ExplanationInput {
  return {
    language: input.language === "ru" || input.language === "kk" ? input.language : "en",
    target: input.target ? { role: input.target.role, grade: input.target.grade } : null,
    recommendations: input.recommendations.map((rec) => ({
      eventId: rec.eventId, title: rec.title, historySignal: rec.historySignal,
      ...(rec.nextSession ? { nextSession: rec.nextSession } : {}),
      expectedChanges: rec.expectedChanges.map(({ skillId, before, after, required, critical }) => ({ skillId, before, after, required, critical })),
      skillNames: Object.fromEntries(rec.expectedChanges.map(({ skillId }) => [skillId, rec.skillNames?.[skillId] ?? skillId])),
      allowedEvidenceRefs: [...rec.allowedEvidenceRefs],
    })),
  };
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

  const fallback = clearPreviousAi(view);

  try {
    const allowedRefsByEvent = new Map(
      fallback.recommendations.map((recommendation) => [
        recommendation.eventId,
        allowedEvidenceRefs(recommendation),
      ]),
    );
    const input = copyExplanationInput({
      language: fallback.employee.preferred_language,
      target: fallback.target,
      recommendations: fallback.recommendations.map((recommendation) => ({
        ...recommendation,
        skillNames: Object.fromEntries(fallback.skillGaps.map((gap) => [gap.skillId, gap.name])),
        allowedEvidenceRefs: allowedRefsByEvent.get(recommendation.eventId) ?? [],
      })),
    });
    const explanations = await explainer.explain(input);
    const validated = validateAiExplanations(explanations, allowedRefsByEvent);

    return {
      ...fallback,
      recommendations: fallback.recommendations.map((recommendation) => {
        const explanation = validated.get(recommendation.eventId);
        return explanation && containsRequiredFacts(explanation, fallback, recommendation) && !hasUnsupportedClaims(explanation, recommendation)
          ? { ...recommendation, aiExplanation: explanation, explanationSource: "llm" }
          : recommendation;
      }),
    };
  } catch {
    return fallback;
  }
}

export function validateAiExplanations(
  explanations: unknown,
  allowedRefsByEvent: Map<string, string[]>,
): Map<string, string> {
  const accepted = new Map<string, string>();
  if (!Array.isArray(explanations)) return accepted;
  const occurrences = new Map<string, number>();
  for (const explanation of explanations) {
    if (!explanation || typeof explanation.eventId !== "string") continue;
    occurrences.set(explanation.eventId, (occurrences.get(explanation.eventId) ?? 0) + 1);
  }
  for (const explanation of explanations) {
    if (!isAiExplanation(explanation)) continue;
    const allowedRefs = allowedRefsByEvent.get(explanation.eventId);
    const uniqueRefs = new Set(explanation.evidenceRefs);
    if (
      !allowedRefs ||
      occurrences.get(explanation.eventId) !== 1 ||
      uniqueRefs.size < 3 ||
      uniqueRefs.size !== explanation.evidenceRefs.length ||
      !uniqueRefs.has("target") ||
      !uniqueRefs.has("history") ||
      ![...uniqueRefs].some((ref) => ref.startsWith("skill:")) ||
      [...uniqueRefs].some((ref) => !allowedRefs.includes(ref))
    ) {
      continue;
    }
    accepted.set(explanation.eventId, explanation.explanation.trim());
  }
  return accepted;
}

export function isAiExplanation(value: unknown): value is AiExplanation {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 3) return false;
  const item = value as Partial<AiExplanation>;
  return typeof item.eventId === "string" && typeof item.explanation === "string" &&
    item.explanation.trim().length > 0 && item.explanation.length <= 1000 &&
    Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => typeof ref === "string");
}

function clearPreviousAi(view: EmployeeView): EmployeeView {
  if (view.recommendations.every((rec) => rec.aiExplanation === undefined && rec.explanationSource === "fallback")) return view;
  return { ...view, recommendations: view.recommendations.map((rec) => {
    const clean: Recommendation = { ...rec, explanationSource: "fallback" };
    delete clean.aiExplanation;
    return clean;
  }) };
}

function allowedEvidenceRefs(recommendation: Recommendation): string[] {
  return [
    "target",
    "history",
    "availability",
    ...recommendation.expectedChanges
      .filter((change) => Math.min(change.after, change.required) > Math.min(change.before, change.required))
      .map((change) => `skill:${change.skillId}`),
  ];
}

import { isDeepStrictEqual } from "node:util";
import type { RecommendationDomainInput, RecommendationEnhancer, RecommendationResult } from "@/contracts/types";

/** Only ordering can change until a fact-grounded explanation contract is agreed. */
export async function enhanceRecommendations(
  enhancer: RecommendationEnhancer,
  result: RecommendationResult,
  input: RecommendationDomainInput,
  timeoutMs = 1500,
): Promise<RecommendationResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const candidate = await Promise.race([
      enhancer.enhance(structuredClone(result), structuredClone(input)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Enhancer timeout")), timeoutMs);
      }),
    ]);
    if (!candidate || !Array.isArray(candidate.recommendations)) return result;
    const { recommendations, source, ...metadata } = candidate;
    const { recommendations: original, source: _source, ...originalMetadata } = result;
    if (!isDeepStrictEqual(metadata, originalMetadata)) return result;
    if (source !== "deterministic" && source !== "ai_enhanced") return result;
    if (recommendations.length !== original.length) return result;
    const originals = new Map(original.map((item) => [item.event.event_id, item]));
    const seen = new Set<string>();
    for (const item of recommendations) {
      const id = item?.event?.event_id;
      if (!id || seen.has(id) || !isDeepStrictEqual(item, originals.get(id))) return result;
      seen.add(id);
    }
    return { ...result, recommendations, source };
  } catch {
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import type {
  RecommendationDomainInput,
  RecommendationEnhancer,
  RecommendationResult,
} from "@/contracts/types";

export class DeterministicEnhancer implements RecommendationEnhancer {
  async enhance(
    result: RecommendationResult,
    _input: RecommendationDomainInput,
  ): Promise<RecommendationResult> {
    return result;
  }
}

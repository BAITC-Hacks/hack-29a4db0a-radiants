import type { EmployeeView } from "../../types/career";

export type AiStatus = "llm" | "partial" | "unavailable" | "not_configured" | "not_needed";

export interface RecommendationResponse {
  view: EmployeeView;
  aiStatus: AiStatus;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmployeeDetail } from "../contracts/api";
import type { CareerApi } from "../lib/frontend/api";
import { createAiRecommendationRequest } from "./ai-recommendation-request";

type AiStatus = "idle" | "loading" | "ready" | "fallback";
interface Snapshot { baseline: EmployeeDetail; view?: EmployeeDetail; status: AiStatus }

/** Keep the fast deterministic profile visible while explanations arrive separately. */
export function useAiRecommendations(api: CareerApi, baseline: EmployeeDetail | undefined, enabled: boolean) {
  const requests = useRef(createAiRecommendationRequest());
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const cancel = useCallback(() => {
    requests.current.cancel();
    setSnapshot(undefined);
  }, []);

  useEffect(() => {
    const request = requests.current;
    if (!enabled || !baseline || !baseline.recommendations.length) {
      request.cancel();
      return;
    }
    setSnapshot({ baseline, status: "loading" });
    void request.run(baseline, (id, signal) => api.getRecommendations(id, signal),
      (view) => setSnapshot({ baseline, view: view ?? undefined,
        status: view?.recommendations.some((item) => item.explanationSource === "llm") ? "ready" : "fallback" }),
      () => setSnapshot({ baseline, status: "fallback" }));
    return () => request.cancel();
  }, [api, baseline, enabled]);

  const current = enabled && snapshot?.baseline === baseline ? snapshot : undefined;
  return { view: current?.view ?? baseline, status: current?.status ?? "idle", cancel };
}

import { useEffect, useMemo, useState } from "react";
import type { CareerDataset, EmployeeView } from "../types/career";
import type { AiStatus, RecommendationResponse } from "../lib/ai/api-contract";

export function useAiRecommendations(dataset: CareerDataset, baseline: EmployeeView | null) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ baseline, attempt }), [baseline, attempt]);
  const [result, setResult] = useState<{
    request: typeof request;
    view: EmployeeView;
    status: AiStatus | "error";
  } | null>(null);

  useEffect(() => {
    if (!baseline?.recommendations.length) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 9_500);
    const employeeId = baseline.employee.employee_id;
    // Only the selected profile and its history are needed by the server.
    const payload = {
      employeeId,
      dataset: { employees: [baseline.employee], events: dataset.events, skills: dataset.skills, roleProfiles: dataset.roleProfiles,
        history: dataset.history.filter((row) => row.employee_id === employeeId) },
    };
    void fetch("/api/recommendations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Recommendation request failed");
      const body = await response.json() as RecommendationResponse;
      if (body.view?.employee?.employee_id !== employeeId || !Array.isArray(body.view.recommendations) ||
        !["llm", "partial", "unavailable", "not_configured", "not_needed"].includes(body.aiStatus)) {
        throw new Error("Invalid recommendation response");
      }
      if (active) setResult({ request, view: body.view, status: body.aiStatus });
    }).catch(() => {
      if (active) setResult({ request, view: baseline, status: "error" });
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [dataset, baseline, request]);

  const current = result?.request === request ? result : null;
  return {
    view: current?.view ?? baseline,
    status: !baseline?.recommendations.length ? "not_needed" as const : current?.status ?? "loading" as const,
    retry: () => setAttempt((value) => value + 1),
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Recommendation } from "../types/career";
import type { CareerApi } from "../lib/frontend/api";
import { LatestRequest } from "../lib/frontend/latest-request";

export function useRecommendations(api: CareerApi, employeeId: string, profileRevision: number, enabled: boolean) {
  const gate = useRef(new LatestRequest());
  const current = useRef({ employeeId, profileRevision, enabled });
  current.current = { employeeId, profileRevision, enabled };
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    employeeId: string; profileRevision: number; data?: Recommendation[]; error?: string; loading: boolean;
  }>();
  const cancel = useCallback(() => {
    gate.current.cancel();
    setState(undefined);
  }, []);
  const retry = useCallback(() => { cancel(); setAttempt((value) => value + 1); }, [cancel]);
  useEffect(() => {
    const requests = gate.current;
    if (!enabled) { requests.cancel(); return; }
    const request = requests.start(employeeId, profileRevision);
    const owns = () => current.current.enabled && request.accepts(current.current.employeeId, current.current.profileRevision);
    setState({ employeeId, profileRevision, loading: true });
    void api.getRecommendations(employeeId, request.signal).then(
      (data) => { if (owns()) setState({ employeeId, profileRevision, data, loading: false }); },
      (error: unknown) => { if (owns()) setState({ employeeId, profileRevision, loading: false,
        error: error instanceof Error ? error.message : "Recommendations are unavailable." }); },
    );
    return () => requests.cancel();
  }, [api, employeeId, profileRevision, enabled, attempt]);
  const valid = enabled && state?.employeeId === employeeId && state.profileRevision === profileRevision;
  return { data: valid ? state.data : undefined, error: valid ? state.error : undefined,
    loading: enabled && (!valid || state.loading), cancel, retry };
}

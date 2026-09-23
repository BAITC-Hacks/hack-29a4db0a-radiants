import type { EmployeeView } from "../types/career";
import type { EmployeeDetail } from "../contracts/api";

export function NoNextStepState({ view }: { view: EmployeeView & Partial<Pick<EmployeeDetail, "recommendationDiagnostics">> }) {
  return <section className="no-recs" aria-label="No next step">
    <h3>No suitable next step is currently available.</h3>
    {view.targetStatus === "needs_career_goal" && <p>Set a career goal to see development steps for a target role.</p>}
    {view.recommendationDiagnostics && <>
      <p>{view.recommendationDiagnostics.summary}</p>
      {view.recommendationDiagnostics.blockedEvents.length > 0 && <details><summary>Why existing activities are unavailable</summary>
        <ul>{view.recommendationDiagnostics.blockedEvents.map((event) => <li key={event.eventId}><strong>{event.title}</strong><ul>{event.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul></li>)}</ul>
      </details>}
    </>}
  </section>;
}

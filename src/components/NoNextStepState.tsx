import type { EmployeeView } from "../types/career";
import type { EmployeeDetail } from "../contracts/api";
import { ChevronDown } from "lucide-react";
import { exclusionLabel } from "../lib/frontend/plain-language";

const diagnosticHeadings = {
  available: "Подходящее обучение найдено",
  needs_career_goal: "Сначала определите карьерную цель",
  target_reached: "Навыки соответствуют выбранной цели",
  no_eligible_events: "Пока нет подходящих мероприятий",
};

export function NoNextStepState({ view }: { view: EmployeeView & Partial<Pick<EmployeeDetail, "recommendationDiagnostics">> }) {
  const diagnostics = view.recommendationDiagnostics;
  return <section className="no-recs" aria-label="Нет рекомендаций">
    <h3 className="diagnostics-status">{diagnostics ? diagnosticHeadings[diagnostics.status] : view.targetStatus === "needs_career_goal" ? diagnosticHeadings.needs_career_goal : diagnosticHeadings.no_eligible_events}</h3>
    {view.targetStatus === "needs_career_goal" && <p>Обсудите с руководителем, в какой роли хотите развиваться. Это поможет подобрать обучение.</p>}
    {view.recommendationDiagnostics && <>
      {diagnostics?.status === "target_reached" && <p>Вы уже достигли нужных уровней навыков. Обсудите следующий этап развития с руководителем.</p>}
      {diagnostics?.status === "no_eligible_events" && <p>Для цели ещё есть что развивать, но сейчас нет доступного занятия, которое поможет. HR может подобрать другой вариант обучения.</p>}
      {view.recommendationDiagnostics.blockedEvents.length > 0 && <details className="diagnostics-details"><summary>Почему другие занятия недоступны<ChevronDown size={16} /></summary>
        <ul>{view.recommendationDiagnostics.blockedEvents.map((event) => <li key={event.eventId}><strong>{event.title}</strong><ul>{event.reasons.map((reason) => <li key={reason.code}>{exclusionLabel(reason.code, reason.message)}</li>)}</ul></li>)}</ul>
      </details>}
    </>}
  </section>;
}

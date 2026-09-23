import type { EmployeeView } from "../types/career";

export function NoNextStepState({ view }: { view: EmployeeView }) {
  return <section className="no-recs" aria-label="Нет рекомендаций">
    <h3>{view.targetStatus === "needs_career_goal" ? "Сначала определите карьерную цель" : "Пока нет подходящих мероприятий"}</h3>
    {view.targetStatus === "needs_career_goal" && <p>Обсудите с руководителем, в какой роли хотите развиваться. Это поможет подобрать обучение.</p>}
  </section>;
}

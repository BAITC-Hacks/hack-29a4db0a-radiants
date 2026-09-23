import { CalendarDays, Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EmployeeView, Recommendation, SkillGap } from "../types/career";
import type { ActivityView, CatalogResult, EmployeeDetail } from "../contracts/api";
import type { CompletionError } from "../lib/frontend/api";
import { NoNextStepState } from "./NoNextStepState";
import { EmptyState, formatNumber } from "./States";
import { formatReadiness, formatReadinessDelta, readinessBarValue, readinessDelta } from "../lib/frontend/readiness";
import { historyLabel, readinessHelp, recommendationLabel } from "../lib/frontend/plain-language";

export interface CompletionSnapshot { before: EmployeeView; after: EmployeeView }
interface Props {
  view: EmployeeView & Partial<Pick<EmployeeDetail, "completedActivities" | "activeMandatoryObligations" | "activityHistory" | "recommendationDiagnostics">>;
  allowCompletion?: boolean;
  skillNames?: Readonly<Record<string, string>>;
  events?: CatalogResult["events"];
  recommendationStatus?: "idle" | "loading" | "ready" | "fallback";
  completing: boolean; completionDisabled: boolean; completion: CompletionSnapshot | null;
  failure: CompletionError | null; onRefresh: () => void; onComplete: (recommendation: Recommendation) => void;
  onDismissCompletion: () => void;
}
export function EmployeeScreen({ view, skillNames = {}, events = [], allowCompletion = true, recommendationStatus, completing, completionDisabled, completion, failure, onRefresh, onComplete, onDismissCompletion }: Props) {
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const requirementIds = new Set(view.skillGaps.map((gap) => gap.skillId));
  const otherSkills = Object.entries(view.effectiveSkills)
    .filter(([id]) => !view.target || !requirementIds.has(id))
    .sort(([a], [b]) => (skillNames[a] ?? a).localeCompare(skillNames[b] ?? b));
  const currentSkills = <div className="table-wrap skills-scroll" role="region" aria-label="Текущие уровни навыков" tabIndex={0}>
    <table className="skills-table"><thead><tr><th scope="col">Навык</th><th scope="col">Уровень</th></tr></thead>
      <tbody>{otherSkills.map(([id, currentLevel]) => <tr key={id}><th scope="row">{skillNames[id] ?? id}</th><td>{currentLevel}</td></tr>)}</tbody>
    </table>
  </div>;
  return <>
    {completion && <CompletionFeedback snapshot={completion} skillNames={skillNames} onDismiss={onDismissCompletion} />}
    {failure && <section className="panel error-state" role="alert">
      <h2>{failure.phase === "refresh" ? "Занятие завершено. Нужно обновить профиль." : failure.phase === "rejected" ? "Не удалось завершить занятие." : "Не удалось подтвердить завершение."}</h2>
      <p>{failure.message}</p>
      <p>{failure.phase === "rejected" ? "Ваш прогресс не изменился." : "Обновите профиль перед повторной попыткой."}</p>
      {failure.phase !== "rejected" && <button className="button button-outline" disabled={completing} onClick={onRefresh}>{completing ? "Обновляем…" : "Обновить профиль"}</button>}
    </section>}
    <section className="employee-overview" aria-label="Профиль сотрудника">
      <div className="profile-main">
        <div className="profile-name"><h2 title={view.employee.employee_id}>{view.employee.full_name || view.employee.employee_id}</h2></div>
        <p className="profile-role">{view.employee.role}<span className="grade-label">{view.employee.grade}</span></p>
        <p className="subline">{view.employee.department}</p>
        <div className="profile-meta"><span>В компании {view.employee.tenure_months} мес.</span></div>
      </div>
      <div className={`career-target-panel ${!view.target ? "without-target" : ""}`}>
        <span className="field-label">Карьерная цель</span>
        {view.target ? <>
          <h3>{view.target.role} <span>{view.target.grade}</span></h3>
          <div className="readiness-heading"><span>Прогресс к цели</span><strong>{formatReadiness(view.readiness)}</strong></div>
          <progress className="readiness-progress" aria-label="Соответствие навыков цели" aria-valuetext={formatReadiness(view.readiness)} value={readinessBarValue(view.readiness)} max={100}>{formatReadiness(view.readiness)}</progress>
          <p className="section-note">Навыки по требованиям роли. Повышение обсуждается отдельно.</p>
        </> : <><h3>Цель пока не выбрана</h3><p>Обсудите следующий шаг с руководителем. Ваши текущие навыки доступны ниже.</p></>}
        {view.target && <details className="readiness-method"><summary>Что означает этот процент?<ChevronDown size={16} /></summary><p>{readinessHelp}</p></details>}
      </div>
    </section>
    <div className="content-grid">
      <section className="recommendations-panel" aria-busy={completing || recommendationStatus === "loading"} aria-labelledby="recommendations-heading">
        <div className="section-header"><div><h2 id="recommendations-heading">Что пройти дальше</h2><p className="section-note">Выберите один из вариантов. Проходить все не обязательно.</p></div></div>
        {recommendationStatus === "loading" && <p className="recommendation-status" role="status"><LoaderCircle size={15} className="spin" /> Уточняем объяснения. Уже можно выбрать занятие.</p>}
        {view.recommendations.length ? <div className="recommendation-list">{view.recommendations.map((recommendation, index) =>
          <RecommendationCard key={recommendation.eventId} recommendation={recommendation} rank={index + 1} view={view} skillNames={skillNames}
            event={events.find((event) => event.event_id === recommendation.eventId)} allowCompletion={allowCompletion} busy={completing} disabled={completionDisabled} onComplete={() => setSelected(recommendation)} />)}</div> : <NoNextStepState view={view} />}
      </section>
      <section className="skills-panel surface" aria-labelledby="skills-heading">
        <div className="section-header"><div><h2 id="skills-heading">{view.target ? view.skillGaps.some(gap => gap.gap > 0) ? "Что ещё развить" : "Навыки для цели" : "Ваши навыки"}</h2><p className="section-note">Уровни от 0 до 5{view.target ? " · сейчас и требования роли" : " · с учётом завершённого обучения"}</p></div></div>
        <details className="level-help"><summary>Что означают уровни?<ChevronDown size={16} /></summary><p>0 — нет знаний; 1 — знаком с основами; 2 — справляется с поддержкой; 3 — работает самостоятельно; 4 — решает сложные задачи и помогает другим; 5 — задаёт стандарты.</p></details>
        {view.target && view.skillGaps.length > 0 ?
          <div className="table-wrap skills-scroll" role="region" aria-label="Навыки и требования роли" tabIndex={0}><table className="skills-table">
            <thead><tr><th scope="col">Навык</th><th scope="col">Сейчас</th><th scope="col">Для цели</th><th scope="col">Разница</th></tr></thead>
            <tbody>{[...view.skillGaps].sort((a, b) => Number(b.gap > 0) - Number(a.gap > 0) || Number(b.critical) - Number(a.critical)).map((gap) => <SkillRow key={gap.skillId} gap={gap} />)}</tbody>
          </table></div> : view.target ? <EmptyState text="Требования к навыкам для этой роли пока не указаны." /> : null}
        {otherSkills.length > 0 ? view.target ? <details className="additional-skills"><summary>Другие навыки <span>{otherSkills.length}</span><ChevronDown size={16} /></summary><p className="section-note">Для этих навыков нет требования в выбранной цели.</p>{currentSkills}</details> : currentSkills : !view.target ? <EmptyState text="Навыки пока не добавлены в профиль." /> : null}
      </section>
    </div>
    <div className="employee-activity-grid">
      {view.activeMandatoryObligations && <section className="activity-section surface" aria-labelledby="mandatory-heading">
        <div className="section-header"><div><h2 id="mandatory-heading">Обязательное обучение</h2><p className="section-note">Назначения, которые нужно пройти</p></div><span className="section-count">{view.activeMandatoryObligations.length}</span></div>
        {view.activeMandatoryObligations.length ? <ActivityTable activities={view.activeMandatoryObligations} mandatory /> : <div className="quiet-success"><Check size={18} /><p>Сейчас нет незавершённых обязательных занятий.</p></div>}
      </section>}
      {view.completedActivities && <section className="activity-section surface" aria-labelledby="completed-heading">
        <div className="section-header"><div><h2 id="completed-heading">Завершённое обучение</h2><p className="section-note">Завершённые занятия · сначала новые</p></div><span className="section-count">{view.completedActivities.length}</span></div>
        {view.completedActivities.length ? <ActivityTable activities={view.completedActivities} /> : <EmptyState text="Здесь появятся завершённые занятия." />}
      </section>}
      {view.activityHistory && <details className="activity-section surface full-activity-history">
        <summary className="history-summary"><h2>Вся история участия</h2><span className="section-count">{view.activityHistory.length}</span><ChevronDown size={16} /></summary>
        {view.activityHistory.length ? <ActivityTable activities={view.activityHistory} fullHistory /> : <EmptyState text="Пока нет записей об участии." />}
      </details>}
    </div>
    {selected && <CompletionConfirmation recommendation={selected} disabled={completionDisabled} onClose={() => setSelected(null)} onConfirm={() => {
      const current = view.recommendations.find(rec => rec.eventId === selected.eventId);
      setSelected(null);
      if (current && !completionDisabled) onComplete(current);
    }} />}
  </>;
}
const activityStatusLabels: Record<ActivityView["status"], string> = {
  completed: "Завершено", in_progress: "В процессе", dropped: "Прервано", no_show: "Неявка", declined: "Отказ", overdue: "Просрочено",
};
const sources = { self: "Самостоятельно", manager: "Руководитель", hr: "HR" };
function dateLabel(date: string) {
  const parsed = new Date(date + (/^\d{4}-\d{2}-\d{2}$/.test(date) ? "T00:00:00Z" : ""));
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}
function ActivityTable({ activities, mandatory = false, fullHistory = false }: { activities: ActivityView[]; mandatory?: boolean; fullHistory?: boolean }) {
  return <div className="table-wrap activity-scroll" role="region" aria-label={mandatory ? "Обязательные занятия" : fullHistory ? "Все записи об участии" : "Завершённые занятия"} tabIndex={0}>
    <table className="activity-table">
      <thead><tr><th scope="col">Занятие</th><th scope="col">{mandatory || fullHistory ? "Дата записи" : "Дата завершения"}</th><th scope="col">Статус</th><th scope="col">Прогресс</th><th scope="col">Инициатор</th>{(mandatory || fullHistory) && <th scope="col">Пройти до</th>}</tr></thead>
      <tbody>{[...activities].sort((a, b) => b.date.localeCompare(a.date)).map((activity) => <tr key={activity.record_id}>
        <th scope="row" title={activity.event_id}>{activity.eventTitle}</th>
        <td><time dateTime={activity.date}>{dateLabel(activity.date)}</time></td>
        <td><span className={`activity-status status-${activity.status}`}>{activityStatusLabels[activity.status]}</span></td>
        <td className="number">{formatNumber(activity.completion_pct)}%</td><td>{sources[activity.assigned_by]}</td>
        {(mandatory || fullHistory) && <td>{activity.due_date ? <time dateTime={activity.due_date}>{dateLabel(activity.due_date)}</time> : "Не указан"}</td>}
      </tr>)}</tbody>
    </table>
  </div>;
}
function SkillRow({ gap }: { gap: SkillGap }) {
  return <tr>
    <th scope="row">{gap.name}{gap.critical && <span className="critical-label">Ключевой навык</span>}</th>
    <td><span className="current-level">{gap.currentLevel}</span></td><td className="required-level">{gap.requiredLevel}</td>
    <td className={gap.gap > 0 ? "gap-open" : "gap-met"}>{gap.gap}</td>
  </tr>;
}
const eventFormatLabels = { online: "Онлайн", offline: "Очно", self_paced: "В своём темпе" };
function RecommendationCard({ recommendation: rec, rank, view, skillNames, event, allowCompletion, busy, disabled, onComplete }: {
  recommendation: Recommendation; rank: number; view: EmployeeView; skillNames: Readonly<Record<string, string>>; event?: CatalogResult["events"][number]; allowCompletion: boolean; busy: boolean; disabled: boolean; onComplete: () => void;
}) {
  const hasAiExplanation = rec.explanationSource === "llm" && Boolean(rec.aiExplanation?.trim());
  const explanation = recommendationLabel(rec, view, skillNames);
  const gains = rec.expectedChanges.filter(change => change.after > change.before);
  const unchanged = rec.expectedChanges.filter(change => change.after <= change.before);
  return <article className={`recommendation-card ${rank === 1 ? "top-recommendation" : ""}`}>
    <div className="rec-topline"><span className="recommendation-label">Вариант {rank}</span></div>
    <h3>{rec.title}</h3>
    <p className="recommendation-purpose">{explanation}</p>
    {event && <div className="rec-facts" aria-label="О занятии"><span>{eventFormatLabels[event.format]}</span><span>{formatNumber(event.duration_hours)} ч</span></div>}
    {rec.nextSession ? <p className="rec-meta"><CalendarDays size={15} /> Ближайшая дата: <time dateTime={rec.nextSession}>{dateLabel(rec.nextSession)}</time></p> :
      event && <p className="rec-meta"><CalendarDays size={15} />{event.format === "self_paced" ? "Без фиксированной даты" : "Дата не указана"}</p>}
    {gains.length > 0 && <div className="impact-box"><h4>После занятия</h4>
      {gains.map((change) => <div className="impact-line" key={change.skillId}>
        <span>{skillName(view, change.skillId, undefined, skillNames)}{change.critical && <span className="critical-label">Ключевой навык</span>}</span>
        <div><strong>{change.before} <span aria-label="до">→</span> {change.after}</strong><small>{change.required === 0 ? "Без требования к цели" : `Для цели: ${change.required}`}</small></div>
      </div>)}
    </div>}
    <div className="recommendation-explanation"><p className="history-signal">{historyLabel(rec.historySignal)}</p><span className="explanation-source">{hasAiExplanation ? "С помощью ИИ" : "По данным профиля"}</span></div>
    <details className="why-block"><summary>О занятии и расчёте<ChevronDown size={16} /></summary>
      {event?.description && <p>{event.description}</p>}
      <p>Указан ожидаемый рост навыков. Профиль изменится только после подтверждения прохождения.</p>
      {unchanged.map(change => <p key={change.skillId}>{skillName(view, change.skillId, undefined, skillNames)}: уровень {change.before} уже достигнут; это занятие его не повысит.</p>)}
    </details>
    {allowCompletion && <button className={`button ${rank === 1 ? "button-green" : "button-outline"} complete-button`} disabled={disabled} onClick={onComplete}>
      {busy && <LoaderCircle className="spin" size={16} />}{busy ? "Обновляем профиль…" : "Я прошёл это занятие"}{!busy && <Check size={16} />}
    </button>}
  </article>;
}
function CompletionConfirmation({ recommendation, disabled, onClose, onConfirm }: { recommendation: Recommendation; disabled: boolean; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="dialog completion-dialog" aria-labelledby="confirm-completion-title" onCancel={onClose}>
    <div className="dialog-head"><h2 id="confirm-completion-title">Завершить занятие?</h2><button className="icon-button" aria-label="Закрыть подтверждение" onClick={onClose}><X size={18} /></button></div>
    <p className="confirmation-title">{recommendation.title}</p>
    <p>Прохождение сохранится в истории, навыки и рекомендации обновятся. Отменить запись в приложении нельзя.</p>
    {recommendation.nextSession && <p className="section-note">В демо результат записывается на дату занятия: {dateLabel(recommendation.nextSession)}.</p>}
    <div className="dialog-foot"><button autoFocus className="button button-outline" onClick={onClose}>Не сейчас</button><button className="button button-green" disabled={disabled} onClick={onConfirm}><Check size={16} />Подтвердить прохождение</button></div>
  </dialog>;
}
export function CompletionFeedback({ snapshot: { before, after }, skillNames = {}, onDismiss }: { snapshot: CompletionSnapshot; skillNames?: Readonly<Record<string, string>>; onDismiss: () => void }) {
  const delta = readinessDelta(before.readiness, after.readiness);
  const ids = [...new Set([...Object.keys(before.effectiveSkills), ...Object.keys(after.effectiveSkills)])];
  const changes = ids.filter((id) => before.effectiveSkills[id] !== after.effectiveSkills[id]);
  return <section className="completion-feedback" role="status" aria-label="Прогресс обновлён">
    <div className="completion-heading"><Check size={20} /><div><h2>Занятие завершено</h2>
      <p>{delta === 0 ? `Профиль обновлён. Соответствие цели осталось на уровне ${formatReadiness(after.readiness)}.` : `Соответствие цели: ${formatReadiness(before.readiness)} → ${formatReadiness(after.readiness)} (${formatReadinessDelta(delta)}).`}</p></div>
      <button className="icon-button" aria-label="Закрыть уведомление" onClick={onDismiss}><X size={18} /></button>
    </div>
    {changes.length > 0 && <ul className="completion-skills">{changes.map((id) => <li key={id}><span>{skillName(after, id, before, skillNames)}</span><strong>{before.effectiveSkills[id] ?? "Не указан"} → {after.effectiveSkills[id] ?? "Не указан"}</strong></li>)}</ul>}
  </section>;
}
function skillName(view: EmployeeView, id: string, previous?: EmployeeView, skillNames: Readonly<Record<string, string>> = {}) {
  return view.skillGaps.find((gap) => gap.skillId === id)?.name ?? previous?.skillGaps.find((gap) => gap.skillId === id)?.name ?? skillNames[id] ?? id;
}

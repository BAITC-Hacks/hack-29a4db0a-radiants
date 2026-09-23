import type { HrSummaryResponse } from "../lib/frontend/api";
import { EmptyState, formatNumber } from "./States";

export function HRDashboard({ summary, onSelect }: { summary: HrSummaryResponse; onSelect: (id: string) => void }) {
  const metrics = summary.metrics;
  return <>
    {metrics && <section className="metric-grid hr-metrics" aria-label="Обзор команды">
      {metrics.totalEmployees !== undefined && <Metric label="Сотрудников" value={String(metrics.totalEmployees)} />}
      {metrics.completionRate !== undefined && <Metric label="Завершённых активностей" value={`${formatNumber(metrics.completionRate)}%`} />}
      {metrics.coverage !== undefined && <Metric label="Охват рекомендациями" value={`${formatNumber(metrics.coverage)}%`} />}
    </section>}
    <div className="hr-grid">
      <section className="hr-section hr-development-section" aria-labelledby="development-needs-heading">
        <div className="section-header"><div><h2 id="development-needs-heading">Развитие команды</h2><p className="section-note">Где сотрудникам нужна поддержка</p></div></div>
        <div className="hr-development-grid">
        <section className="hr-subsection" aria-labelledby="common-gaps-heading">
        <div className="hr-table-heading"><h3 id="common-gaps-heading">Навыки для развития</h3><span className="section-note">Уровень ниже целевого</span></div>
        {summary.weakCompetencies.length ? <div className="table-wrap hr-table-scroll" role="region" aria-label="Навыки для развития" tabIndex={0}><table>
          <thead><tr><th scope="col">Навык</th><th scope="col" className="number">Сотрудников</th></tr></thead>
          <tbody>{summary.weakCompetencies.map((skill) => <tr key={skill.skillId}>
            <th scope="row">{skill.name}</th><td className="number">{skill.employeesBelowRequirement}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyState text="Пробелов в навыках не выявлено." />}
        </section>
        <section className="hr-subsection" aria-labelledby="followup-heading">
        <div className="hr-table-heading"><h3 id="followup-heading">Сотрудники без рекомендаций</h3><span className="section-note">Нажмите на имя, чтобы открыть профиль</span></div>
        {summary.employeesWithoutRecommendations.length ? <div className="table-wrap hr-table-scroll" role="region" aria-label="Сотрудники без рекомендаций" tabIndex={0}><table>
          <thead><tr><th scope="col">Сотрудник</th><th scope="col">Причина</th></tr></thead>
          <tbody>{summary.employeesWithoutRecommendations.map((item) => <tr key={item.employeeId}>
            <th scope="row"><button className="text-button" title={item.employeeId} onClick={() => onSelect(item.employeeId)}>{item.fullName || item.employeeId}</button></th>
            <td><span className="hr-followup-status">{item.reason === "needs_career_goal" ? "Нужна карьерная цель" : "Нет подходящей рекомендации"}</span></td>
          </tr>)}</tbody>
        </table></div> : <EmptyState text="Сотрудников без рекомендаций нет." />}
        </section>
        </div>
      </section>
      <section className="hr-section participation-section" aria-labelledby="participation-heading">
        <div className="section-header"><div><h2 id="participation-heading">Участие в обучении</h2><p className="section-note">Количество участников по статусу</p></div><span className="section-count">Активностей: {summary.participationByEvent.length}</span></div>
        {summary.participationByEvent.length ? <div className="table-wrap hr-table-scroll hr-participation-scroll" tabIndex={0} role="region" aria-label="Участие в обучении">
          <table><caption className="sr-only">Количество участников каждой активности</caption>
            <thead><tr><th scope="col">Активность</th><th scope="col" className="number">Завершили</th><th scope="col" className="number">В процессе</th><th scope="col" className="number">Прервали</th><th scope="col" className="number">Не пришли</th><th scope="col" className="number">Отказались</th><th scope="col" className="number">Просрочили</th><th scope="col" className="number">Всего</th></tr></thead>
            <tbody>{summary.participationByEvent.map((event) => <tr key={event.eventId}>
              <th scope="row" title={event.eventId}>{event.title || event.eventId}</th>
              <td className="number status-number done">{event.byStatus.completed ?? "—"}</td>
              <td className="number">{event.byStatus.in_progress ?? "—"}</td><td className="number">{event.byStatus.dropped ?? "—"}</td>
              <td className="number">{event.byStatus.no_show ?? "—"}</td><td className="number">{event.byStatus.declined ?? "—"}</td>
              <td className="number">{event.byStatus.overdue ?? "—"}</td><td className="number hr-total">{event.total}</td>
            </tr>)}</tbody>
          </table>
        </div> : <EmptyState text="Пока нет данных об участии." />}
        {summary.participationByEvent.length > 0 && <p className="table-note">— Нет данных</p>}
      </section>
    </div>
  </>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong></div>;
}

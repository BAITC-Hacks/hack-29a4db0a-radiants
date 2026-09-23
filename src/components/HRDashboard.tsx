import { Activity, ArrowUpRight, Compass, Layers3, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { HrSummaryResponse } from "../lib/frontend/api";
import { EmptyState, formatNumber, initials } from "./States";

export function HRDashboard({ summary, onSelect }: { summary: HrSummaryResponse; onSelect: (id: string) => void }) {
  const metrics = summary.metrics;
  return <>
    {metrics && <section className="metric-grid">
      {metrics.totalEmployees !== undefined && <Metric icon={<Users />} label="Employees" value={String(metrics.totalEmployees)} />}
      {metrics.completionRate !== undefined && <Metric icon={<Activity />} label="Completion rate" value={`${formatNumber(metrics.completionRate)}%`} />}
      {metrics.coverage !== undefined && <Metric icon={<Compass />} label="Recommendation coverage" value={`${formatNumber(metrics.coverage)}%`} />}
    </section>}
    <section className="hr-grid">
      <article className="panel hr-card">
        <div className="section-header"><div><span className="eyebrow">COMMON GAPS</span><h2>Skills to invest in</h2></div><Layers3 size={18} className="muted-icon" /></div>
        <div className="hr-gap-list">{summary.weakCompetencies.map((skill) => <div className="hr-gap-row api-gap-row" key={skill.skillId}>
          <strong>{skill.name}</strong><span className="gap-count">{skill.employeesBelowRequirement}<small> {skill.employeesBelowRequirement === 1 ? "person" : "people"} below requirement</small></span>
        </div>)}</div>
        {!summary.weakCompetencies.length && <EmptyState text="No competency gaps were reported." />}
      </article>
      <article className="panel hr-card">
        <div className="section-header"><div><span className="eyebrow">FOLLOW UP</span><h2>Employees without a next step</h2></div></div>
        <div className="followup-list">{summary.employeesWithoutRecommendations.map((item) => <button className="followup-row" key={item.employeeId} onClick={() => onSelect(item.employeeId)}>
          <span className="avatar small-avatar">{initials(item.fullName)}</span><span className="followup-name"><strong>{item.fullName || item.employeeId}</strong><small>{item.employeeId}</small></span>
          <span className="reason-tag">{item.reason === "needs_career_goal" ? "Career goal needed" : "No eligible step"}</span><ArrowUpRight size={15} />
        </button>)}</div>
        {!summary.employeesWithoutRecommendations.length && <EmptyState text="No employees without a next step were reported." />}
      </article>
      <article className="panel hr-card participation-card">
        <div className="section-header"><div><span className="eyebrow">ACTIVITY PARTICIPATION</span><h2>Catalog engagement</h2></div></div>
        {summary.participationByEvent.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Activity participation table">
          <table><caption className="sr-only">Participation counts reported for each activity</caption>
            <thead><tr><th scope="col">Activity</th><th scope="col">Completed</th><th scope="col">In progress</th><th scope="col">Dropped</th><th scope="col">No show</th><th scope="col">Declined</th><th scope="col">Overdue</th><th scope="col">Total</th></tr></thead>
            <tbody>{summary.participationByEvent.map((event) => <tr key={event.eventId}>
              <th scope="row"><strong>{event.title}</strong><small>{event.eventId}</small></th>
              <td className="status-number done">{event.byStatus.completed ?? "—"}</td>
              <td>{event.byStatus.in_progress ?? "—"}</td><td>{event.byStatus.dropped ?? "—"}</td>
              <td>{event.byStatus.no_show ?? "—"}</td><td>{event.byStatus.declined ?? "—"}</td>
              <td>{event.byStatus.overdue ?? "—"}</td><td>{event.total}</td>
            </tr>)}</tbody>
          </table><p className="table-note">— means no count was supplied.</p>
        </div> : <EmptyState text="No activity participation was reported." />}
      </article>
    </section>
  </>;
}
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <article className="panel metric-card"><div className="metric-head"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><strong>{value}</strong></article>;
}

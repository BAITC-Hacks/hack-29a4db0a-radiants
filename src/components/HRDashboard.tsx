import type { HrSummaryResponse } from "../lib/frontend/api";
import { EmptyState, formatNumber } from "./States";

export function HRDashboard({ summary, onSelect }: { summary: HrSummaryResponse; onSelect: (id: string) => void }) {
  const metrics = summary.metrics;
  return <>
    {metrics && <section className="metric-grid">
      {metrics.totalEmployees !== undefined && <Metric label="Employees" value={String(metrics.totalEmployees)} />}
      {metrics.completionRate !== undefined && <Metric label="Completion rate" value={`${formatNumber(metrics.completionRate)}%`} />}
      {metrics.coverage !== undefined && <Metric label="Recommendation coverage" value={`${formatNumber(metrics.coverage)}%`} />}
    </section>}
    <section className="hr-grid">
      <section className="hr-section" aria-labelledby="common-gaps-heading">
        <div className="section-header"><h2 id="common-gaps-heading">Common skill gaps</h2><p className="section-note">Employees below target requirements</p></div>
        {summary.weakCompetencies.length ? <div className="table-wrap" role="region" aria-label="Common skill gaps table" tabIndex={0}><table>
          <thead><tr><th scope="col">Skill</th><th scope="col" className="number">Employees</th></tr></thead>
          <tbody>{summary.weakCompetencies.map((skill) => <tr key={skill.skillId}>
            <th scope="row">{skill.name}</th><td className="number">{skill.employeesBelowRequirement}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyState text="No competency gaps were reported." />}
      </section>
      <section className="hr-section" aria-labelledby="followup-heading">
        <div className="section-header"><h2 id="followup-heading">Employees without a next step</h2><p className="section-note">Open a profile to review its development needs</p></div>
        {summary.employeesWithoutRecommendations.length ? <div className="table-wrap" role="region" aria-label="Employees requiring follow-up" tabIndex={0}><table>
          <thead><tr><th scope="col">Employee</th><th scope="col">Status</th></tr></thead>
          <tbody>{summary.employeesWithoutRecommendations.map((item) => <tr key={item.employeeId}>
            <th scope="row"><button className="text-button" onClick={() => onSelect(item.employeeId)}>{item.fullName || item.employeeId}</button><small>{item.employeeId}</small></th>
            <td>{item.reason === "needs_career_goal" ? "Career goal needed" : "No eligible step"}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyState text="No employees without a next step were reported." />}
      </section>
      <section className="hr-section participation-section" aria-labelledby="participation-heading">
        <div className="section-header"><h2 id="participation-heading">Activity participation</h2><p className="section-note">Participation counts by activity and status</p></div>
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
      </section>
    </section>
  </>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong></div>;
}

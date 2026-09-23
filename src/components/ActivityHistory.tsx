import type { ActivityStatus } from "../types/career";
import type { DisplayCatalog, ProfileResponse } from "../lib/frontend/api";
import { EmptyState } from "./States";

const labels: Record<ActivityStatus, string> = {
  completed: "Completed", in_progress: "In progress", dropped: "Dropped", declined: "Declined", no_show: "No show", overdue: "Overdue",
};
const sources = { self: "Self", manager: "Manager", hr: "HR" };

export function ActivityHistory({ view, catalog }: { view: ProfileResponse; catalog?: DisplayCatalog }) {
  const supplied = [...(view.completedActivities ?? []), ...(view.activeMandatoryObligations ?? [])];
  const rows = [...new Map(supplied.filter((row) => row.employee_id === view.employee.employee_id).map((row) => [row.record_id, row])).values()]
    .sort((a, b) => b.date.localeCompare(a.date));
  const available = view.completedActivities !== undefined || view.activeMandatoryObligations !== undefined;
  return <section className="activity-history" aria-labelledby="activity-history-heading">
    <div className="section-header"><h2 id="activity-history-heading">Activity history</h2>
      <p className="section-note">Completed activities and active mandatory assignments supplied by the server · newest first</p>
    </div>
    {rows.length ? <div className="table-wrap history-scroll" role="region" aria-label="Activity history records" tabIndex={0}>
      <table className="skills-table history-table"><thead><tr><th scope="col">Activity</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Completion</th><th scope="col">Assigned by</th><th scope="col">Duration</th></tr></thead>
        <tbody>{rows.map((row) => {
          const event = catalog?.events.find((item) => item.event_id === row.event_id);
          return <tr key={row.record_id}><th scope="row">{row.eventTitle || event?.title || row.event_id}</th>
            <td><span className={`activity-status status-${row.status}`}>{labels[row.status]}</span></td>
            <td><time dateTime={row.date}>{row.date}</time></td><td>{row.completion_pct}%</td>
            <td>{sources[row.assigned_by] ?? "—"}</td><td>{event ? `${event.duration_hours} h` : "—"}</td></tr>;
        })}</tbody>
      </table>
    </div> : <EmptyState text={available ? "No activity history was returned for this profile." : "Activity history is not available in this profile response."} />}
  </section>;
}

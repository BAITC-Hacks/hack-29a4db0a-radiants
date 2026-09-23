import { LoaderCircle, X } from "lucide-react";
import type { EmployeeView, Recommendation, SkillGap } from "../types/career";
import type { CompletionError } from "../lib/frontend/api";
import { NoNextStepState } from "./NoNextStepState";
import { EmptyState, formatNumber } from "./States";
import { formatReadiness, formatReadinessDelta, readinessBarValue, readinessDelta } from "../lib/frontend/readiness";

export interface CompletionSnapshot { before: EmployeeView; after: EmployeeView }
interface Props {
  view: EmployeeView; completing: boolean; completionDisabled: boolean; completion: CompletionSnapshot | null;
  failure: CompletionError | null; onRefresh: () => void; onComplete: (recommendation: Recommendation) => void;
  onDismissCompletion: () => void;
}
export function EmployeeScreen({ view, completing, completionDisabled, completion, failure, onRefresh, onComplete, onDismissCompletion }: Props) {
  return <>
    {completion && <CompletionFeedback snapshot={completion} onDismiss={onDismissCompletion} />}
    {failure && <section className="panel error-state" role="alert">
      <h2>{failure.phase === "refresh" ? "Activity completed. Profile refresh needed." : failure.phase === "rejected" ? "Could not complete this activity." : "Could not confirm this activity."}</h2>
      <p>{failure.message}</p>
      <p>{failure.phase === "rejected" ? "Your progress has not been changed." : "Reload your profile before attempting this activity again."}</p>
      {failure.phase !== "rejected" && <button className="button button-outline" disabled={completing} onClick={onRefresh}>{completing ? "Refreshing…" : "Reload profile"}</button>}
    </section>}
    <section className="employee-overview" aria-label="Employee profile">
      <div className="profile-main">
        <div className="profile-name"><h2>{view.employee.full_name || view.employee.employee_id}</h2><span className="id-label">{view.employee.employee_id}</span></div>
        <p className="profile-role">{view.employee.role} <span>· {view.employee.grade}</span></p>
        <p className="subline">{view.employee.department} · {view.employee.tenure_months} months at company</p>
      </div>
      <div className="readiness-panel">
        <div className="readiness-heading"><h3>{view.target ? `Readiness for ${view.target.grade}` : "Career goal needed"}</h3><strong>{formatReadiness(view.readiness)}</strong></div>
        <progress className="readiness-progress" aria-label="Readiness" aria-valuetext={formatReadiness(view.readiness)} value={readinessBarValue(view.readiness)} max={100}>{formatReadiness(view.readiness)}</progress>
        <p className="section-note">Development indicator · not a promotion decision</p>
      </div>
      <div className="career-path" aria-label="Career path">
        <span className="field-label">Career path</span>
        <span><span className="path-label">Current</span> {view.employee.grade} · {view.employee.role}</span>
        <span className="path-arrow" aria-hidden="true">→</span>
        <span className="career-target"><span className="path-label">Target</span> {view.target ? `${view.target.grade} · ${view.target.role}` : "No career goal provided"}</span>
      </div>
    </section>
    <div className="content-grid">
      <section className="skills-panel" aria-labelledby="skills-heading">
        <div className="section-header"><h2 id="skills-heading">Skills and gaps</h2><p className="section-note">Progress against target requirements</p></div>
        {view.skillGaps.length ? <div className="table-wrap" role="region" aria-label="Skill requirements" tabIndex={0}><table className="skills-table">
          <thead><tr><th scope="col">Skill</th><th scope="col">Current progress</th><th scope="col">Projected</th><th scope="col">Required</th><th scope="col">Gap</th></tr></thead>
          <tbody>{view.skillGaps.map((gap) => <SkillRow key={gap.skillId} gap={gap} />)}</tbody>
        </table></div> : <EmptyState text="No skill requirements were provided for this target." />}
      </section>
      <section className="recommendations-panel" aria-busy={completing} aria-labelledby="recommendations-heading">
        <div className="section-header"><h2 id="recommendations-heading">Recommended next steps</h2><p className="section-note">Expected changes and reasons for each activity</p></div>
        {view.recommendations.length ? <div className="recommendation-list">{view.recommendations.map((recommendation, index) =>
          <RecommendationCard key={recommendation.eventId} recommendation={recommendation} rank={index + 1} view={view}
            busy={completing} disabled={completionDisabled} onComplete={() => onComplete(recommendation)} />)}</div> : <NoNextStepState view={view} />}
      </section>
    </div>
  </>;
}

function SkillRow({ gap }: { gap: SkillGap }) {
  return <tr>
    <th scope="row">{gap.name}{gap.critical && <span className="critical-label">Critical</span>}</th>
    <td>{gap.currentLevel}</td><td>{gap.projectedLevel}</td><td>{gap.requiredLevel}</td>
    <td className={gap.gap ? "gap-open" : "gap-met"}>{gap.gap}</td>
  </tr>;
}
function RecommendationCard({ recommendation: rec, rank, view, busy, disabled, onComplete }: {
  recommendation: Recommendation; rank: number; view: EmployeeView; busy: boolean; disabled: boolean; onComplete: () => void;
}) {
  return <article className={`recommendation-card ${rank === 1 ? "top-recommendation" : ""}`}>
    <div className="rec-topline"><span>Step {rank}</span><span>Score {formatNumber(rec.score)}</span></div>
    <h3>{rec.title}</h3>
    {rec.nextSession && <p className="rec-meta">Next session: {rec.nextSession}</p>}
    {rec.expectedChanges.length > 0 && <div className="impact-box"><h4>Expected skill changes</h4>
      {rec.expectedChanges.map((change) => <div className="impact-line" key={change.skillId}>
        <span>{skillName(view, change.skillId)}{change.critical && <span className="critical-label inline">Critical</span>}</span>
        <strong>{change.before} <span aria-label="to">→</span> {change.after}<small> / {change.required} required</small></strong>
      </div>)}
    </div>}
    <div className="why-block"><h4>Why this step</h4>
      {rec.reasons.length ? <ul>{rec.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : rec.deterministicExplanation && <p>{rec.deterministicExplanation}</p>}
      {rec.historySignal && <p className="history-signal">{rec.historySignal}</p>}
    </div>
    {rec.aiExplanation?.trim() && <aside className="ai-explanation"><h4>AI-assisted explanation</h4><p>{rec.aiExplanation}</p></aside>}
    <button className={`button ${rank === 1 ? "button-green" : "button-outline"} complete-button`} disabled={disabled} onClick={onComplete}>
      {busy && <LoaderCircle className="spin" size={15} />}{busy ? "Updating profile…" : "Complete activity"}
    </button>
  </article>;
}
export function CompletionFeedback({ snapshot: { before, after }, onDismiss }: { snapshot: CompletionSnapshot; onDismiss: () => void }) {
  const delta = readinessDelta(before.readiness, after.readiness);
  const ids = [...new Set([...Object.keys(before.effectiveSkills), ...Object.keys(after.effectiveSkills)])];
  const changes = ids.filter((id) => before.effectiveSkills[id] !== after.effectiveSkills[id]);
  return <section className="completion-feedback" role="status" aria-label="Progress updated">
    <div className="completion-heading"><div><h2>{delta === 0 ? "Activity completed." : "Progress updated"}</h2>
      <p>{delta === 0 ? `Your development profile has been updated. Readiness remains at ${formatReadiness(after.readiness)}.` : `Readiness ${delta > 0 ? "increased" : "changed"} from ${formatReadiness(before.readiness)} to ${formatReadiness(after.readiness)}.`}</p></div>
      <button className="icon-button" aria-label="Dismiss progress update" onClick={onDismiss}><X size={16} /></button>
    </div>
    {delta !== 0 && <div className="completion-readiness">Readiness <strong>{formatReadiness(before.readiness)} → {formatReadiness(after.readiness)}</strong><span>{formatReadinessDelta(delta)}</span></div>}
    {changes.length > 0 && <ul className="completion-skills">{changes.map((id) => <li key={id}><span>{skillName(after, id, before)}</span><strong>{before.effectiveSkills[id] ?? "Not reported"} → {after.effectiveSkills[id] ?? "Not reported"}</strong></li>)}</ul>}
  </section>;
}
function skillName(view: EmployeeView, id: string, previous?: EmployeeView) {
  return view.skillGaps.find((gap) => gap.skillId === id)?.name ?? previous?.skillGaps.find((gap) => gap.skillId === id)?.name ?? id;
}

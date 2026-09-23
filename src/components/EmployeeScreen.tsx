import type { CSSProperties } from "react";
import { Activity, ArrowRight, ArrowUpRight, Check, CircleHelp, Gauge, LoaderCircle, Sparkles, Target, X } from "lucide-react";
import type { EmployeeView, Recommendation, SkillGap } from "../types/career";
import type { CompletionError } from "../lib/frontend/api";
import { NoNextStepState } from "./NoNextStepState";
import { EmptyState, formatNumber, initials } from "./States";
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
    <section className="overview-grid">
      <article className="panel profile-panel">
        <div className="panel-top"><span className="eyebrow">YOUR PROFILE</span><span className="id-label">{view.employee.employee_id}</span></div>
        <div className="profile-main"><div className="avatar">{initials(view.employee.full_name)}</div><div><h2>{view.employee.full_name || view.employee.employee_id}</h2>
          <div className="subline">{view.employee.department} <span>·</span> {view.employee.tenure_months} months with the company</div></div></div>
        <div className="role-pair">
          <div><span className="field-label">CURRENT ROLE</span><strong>{view.employee.role}</strong><span className="grade-tag">{view.employee.grade}</span></div>
          <ArrowRight className="role-arrow" size={18} />
          <div><span className="field-label">CAREER TARGET</span><strong>{view.target?.role ?? "No target provided"}</strong><span className="grade-tag target-tag">{view.target?.grade ?? "Goal needed"}</span></div>
        </div>
      </article>
      <article className="panel readiness-panel">
        <div className="panel-top"><span className="eyebrow">READINESS SNAPSHOT</span><Gauge size={17} className="muted-icon" /></div>
        <div className="readiness-content">
          <div className="ring" style={{ "--progress": `${readinessBarValue(view.readiness)}%` } as CSSProperties}><div><strong>{formatReadiness(view.readiness)}</strong><span>ready</span></div></div>
          <div className="readiness-copy"><h3>{view.target ? `Readiness for ${view.target.grade}` : "Career goal needed"}</h3>
            <p>{view.target?.role ?? "Set a career goal to see development requirements."}</p>
            <progress className="readiness-progress" aria-label="Readiness" aria-valuetext={formatReadiness(view.readiness)} value={readinessBarValue(view.readiness)} max={100}>{formatReadiness(view.readiness)}</progress>
            <small>Development indicator · not a promotion decision</small>
          </div>
        </div>
      </article>
    </section>
    <section className="content-grid">
      <div className="left-stack">
        <article className="panel path-panel">
          <div className="section-header"><div><span className="eyebrow">CAREER TRAJECTORY</span><h2>Your next chapter</h2></div><Target size={19} className="muted-icon" /></div>
          <div className="career-path">
            <div className="path-node complete-node"><span className="node-dot"><Check size={13} /></span><div><strong>{view.employee.grade}</strong><small>{view.employee.role}</small></div><span className="path-caption">CURRENT</span></div>
            <div className="path-line" />
            <div className={`path-node ${view.target ? "target-node" : "muted-node"}`}><span className="node-dot">{view.target ? <ArrowUpRight size={14} /> : <CircleHelp size={14} />}</span>
              <div><strong>{view.target?.grade ?? "Career goal"}</strong><small>{view.target?.role ?? "No target provided"}</small></div><span className="path-caption">TARGET</span></div>
          </div>
        </article>
        <article className="panel skills-panel">
          <div className="section-header"><div><span className="eyebrow">TARGET REQUIREMENTS</span><h2>Skills and gaps</h2></div></div>
          {view.skillGaps.length ? <div className="skill-list">{view.skillGaps.map((gap) => <SkillRow key={gap.skillId} gap={gap} />)}</div> : <EmptyState text="No skill requirements were provided for this target." />}
        </article>
      </div>
      <article className="panel recommendations-panel" aria-busy={completing}>
        <div className="section-header"><div><span className="eyebrow">PERSONALIZED FOR YOU</span><h2>Your next best steps</h2><p className="section-note">Recommended development activities</p></div><span className="ai-pill"><Sparkles size={13} /> Evidence based</span></div>
        {view.recommendations.length ? <div className="recommendation-list">{view.recommendations.map((recommendation, index) =>
          <RecommendationCard key={recommendation.eventId} recommendation={recommendation} rank={index + 1} view={view}
            busy={completing} disabled={completionDisabled} onComplete={() => onComplete(recommendation)} />)}</div> : <NoNextStepState view={view} />}
      </article>
    </section>
  </>;
}

function SkillRow({ gap }: { gap: SkillGap }) {
  return <div className="skill-row">
    <div className="skill-title"><span>{gap.name}{gap.critical && <span className="tiny-critical">Critical</span>}</span>
      <span className={`gap-badge ${gap.gap ? "gap-open" : "gap-met"}`}>Gap: {gap.gap}</span></div>
    <div className="skill-track" aria-hidden="true"><span className="track-current" style={{ width: `${gap.currentLevel / 5 * 100}%` }} /><span className="track-effective" style={{ left: `${gap.projectedLevel / 5 * 100}%` }} /><span className="track-target" style={{ left: `${gap.requiredLevel / 5 * 100}%` }} /></div>
    <div className="skill-values"><span>Current progress <b>{gap.currentLevel}</b> · Projected <b>{gap.projectedLevel}</b></span><span>Required <b>{gap.requiredLevel}</b></span></div>
  </div>;
}
function RecommendationCard({ recommendation: rec, rank, view, busy, disabled, onComplete }: {
  recommendation: Recommendation; rank: number; view: EmployeeView; busy: boolean; disabled: boolean; onComplete: () => void;
}) {
  return <article className={`recommendation-card ${rank === 1 ? "top-recommendation" : ""}`}>
    <div className="rec-topline"><span className="rec-rank">STEP {rank}</span><span className="score"><small>SCORE </small>{formatNumber(rec.score)}</span></div>
    <h3>{rec.title}</h3>
    {rec.nextSession && <p className="rec-meta">Next session: {rec.nextSession}</p>}
    {rec.expectedChanges.length > 0 && <div className="impact-box"><div className="impact-label">EXPECTED SKILL IMPACT</div>
      {rec.expectedChanges.map((change) => <div className="impact-line" key={change.skillId}>
        <span>{skillName(view, change.skillId)}{change.critical && <span className="tiny-critical">Critical</span>}</span>
        <strong>{change.before} <span aria-label="to">→</span> {change.after}<small> / {change.required} required</small></strong>
      </div>)}
    </div>}
    <div className="why-block"><div className="why-heading"><Sparkles size={13} /> WHY THIS STEP?</div>
      {rec.reasons.length ? <ul>{rec.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : rec.deterministicExplanation && <p>{rec.deterministicExplanation}</p>}
      {rec.historySignal && <p className="history-signal"><Activity size={13} />{rec.historySignal}</p>}
    </div>
    {rec.aiExplanation?.trim() && <aside className="ai-insight"><h4>AI insight</h4><p>{rec.aiExplanation}</p></aside>}
    <button className={`button ${rank === 1 ? "button-green" : "button-outline"} complete-button`} disabled={disabled} onClick={onComplete}>
      {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{busy ? "Updating profile…" : "Complete activity"}
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

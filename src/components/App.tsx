import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, ChevronDown, CircleHelp, Clock3, CloudUpload, Compass, FileUp, Gauge, Layers3, RefreshCw, Sparkles, Target, Users, X } from "lucide-react";
import type { CareerDataset, EmployeeView, Recommendation } from "../types/career";
import { getEmployeeView } from "../lib/recommendation";
import { normalizeDataset } from "../lib/data/normalize";
import { buildHrSummary } from "../lib/analytics/hr-summary";
import { loadDataset, parseImportText, saveDataset } from "../lib/frontend/dataset";
import { useAiRecommendations } from "../hooks/use-ai-recommendations";

export default function App() {
  const [dataset, setDataset] = useState<CareerDataset>(() => loadDataset());
  const [employeeId, setEmployeeId] = useState(dataset.employees[0]?.employee_id ?? "");
  const [screen, setScreen] = useState<"employee" | "hr">("employee");
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const normalized = useMemo(() => normalizeDataset(dataset), [dataset]);
  const baseline = useMemo(() => employeeId ? getEmployeeView(normalized, employeeId) : null, [normalized, employeeId]);
  const { view, status: aiStatus, retry: retryAi } = useAiRecommendations(dataset, baseline);

  function update(next: CareerDataset, message: string) {
    setDataset(next); saveDataset(next); setNotice(message); window.setTimeout(() => setNotice(""), 4200);
  }

  function complete(recommendation: Recommendation) {
    const event = dataset.events.find((item) => item.event_id === recommendation.eventId);
    if (!event || !view) return;
    const next = structuredClone(dataset);
    next.history.push({ record_id: `DEMO-${Date.now()}`, employee_id: employeeId, event_id: event.event_id, date: "2026-10-01", due_date: null, status: "completed", completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self" });
    const impact = recommendation.expectedChanges.filter((change) => change.after > change.before).map((change) => `${skillName(next, change.skillId)} ${change.before} → ${change.after}`).join(", ");
    update(next, `Activity completed. ${impact || event.title}`);
  }

  function importData(next: CareerDataset, label: string) {
    const current = employeeId;
    update(next, label);
    if (!next.employees.some((employee) => employee.employee_id === current)) setEmployeeId(next.employees[0]?.employee_id ?? "");
    setImportOpen(false);
  }

  const hr = useMemo(() => buildHrSummary(normalized), [normalized]);
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setScreen("employee"); }}><span className="brand-mark"><Compass size={19} /></span><span>career<span className="brand-light">quest</span></span></a>
      <div className="topbar-right">
        <span className="demo-tag"><span /> Demo workspace</span>
        <button className={`nav-link ${screen === "employee" ? "selected" : ""}`} onClick={() => setScreen("employee")}><BriefcaseBusiness size={16} /> Employee view</button>
        <button className={`nav-link ${screen === "hr" ? "selected" : ""}`} onClick={() => setScreen("hr")}><Users size={16} /> HR overview</button>
        <button className="button button-dark top-import" onClick={() => setImportOpen(true)}><FileUp size={16} /> Import data</button>
      </div>
    </header>
    {notice && <div className="toast" role="status"><Check size={17} />{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}
    {screen === "employee" ? <main className="page">
      <div className="page-heading"><div><div className="eyebrow"><Sparkles size={14} /> PEOPLE DEVELOPMENT</div><h1>Growth, with direction.</h1><p>A clear next step, grounded in real skills and experience.</p></div>
        <label className="select-wrap" htmlFor="employee-select"><span className="sr-only">Select employee</span><select id="employee-select" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>{dataset.employees.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name} · {employee.role}</option>)}</select><ChevronDown size={16} /></label>
      </div>
      {view ? <>
        <section className="overview-grid">
          <article className="panel profile-panel"><div className="panel-top"><span className="eyebrow">YOUR PROFILE</span><span className="id-label">{view.employee.employee_id}</span></div><div className="profile-main"><div className="avatar">{initials(view.employee.full_name)}</div><div><h2>{view.employee.full_name}</h2><div className="subline">{view.employee.department} <span>·</span> {view.employee.tenure_months} months at Halyk</div></div></div><div className="role-pair"><div><span className="field-label">CURRENT ROLE</span><strong>{view.employee.role}</strong><span className="grade-tag">{view.employee.grade}</span></div><ArrowRight className="role-arrow" size={18} /><div><span className="field-label">NEXT CAREER STEP</span><strong>{view.target?.role ?? "Choose a career goal"}</strong><span className="grade-tag target-tag">{view.target?.grade ?? "Goal needed"}</span></div></div></article>
          <article className="panel readiness-panel"><div className="panel-top"><span className="eyebrow">READINESS SNAPSHOT</span><span className="muted-icon"><Gauge size={17} /></span></div><div className="readiness-content"><div className="ring" style={{ "--progress": `${view.readiness}%` } as React.CSSProperties}><div><strong>{view.readiness}%</strong><span>ready</span></div></div><div className="readiness-copy"><h3>{view.target ? `On your way to ${view.target.grade}` : "Your path starts here"}</h3><p>{view.target ? `${view.skillGaps.filter((gap) => gap.gap > 0).length} skill ${view.skillGaps.filter((gap) => gap.gap > 0).length === 1 ? "gap" : "gaps"} to focus on` : "Set a career goal to see your readiness."}</p><div className="mini-progress"><span style={{ width: `${view.readiness}%` }} /></div><small>Based on target role requirements</small></div></div></article>
        </section>
        <section className="content-grid">
          <div className="left-stack">
            <article className="panel path-panel"><div className="section-header"><div><span className="eyebrow">CAREER TRAJECTORY</span><h2>Your next chapter</h2></div><Target size={19} className="muted-icon" /></div><div className="career-path"><div className="path-node complete-node"><span className="node-dot"><Check size={13} /></span><div><strong>{view.employee.grade}</strong><small>{view.employee.role}</small></div><span className="path-caption">YOU ARE HERE</span></div><div className="path-line"><span /></div><div className={`path-node ${view.target ? "target-node" : "muted-node"}`}><span className="node-dot">{view.target ? <ArrowUpRight size={14} /> : <CircleHelp size={14} />}</span><div><strong>{view.target?.grade ?? "Career goal"}</strong><small>{view.target?.role ?? "Set your direction"}</small></div><span className="path-caption">{view.target ? "YOUR NEXT STEP" : "NEEDS INPUT"}</span></div></div></article>
            <article className="panel skills-panel"><div className="section-header"><div><span className="eyebrow">SKILLS FOR YOUR NEXT STEP</span><h2>Where to focus</h2></div><span className="count-pill">{view.skillGaps.length} skills</span></div>{view.skillGaps.length ? <div className="skill-list">{view.skillGaps.map((gap) => <SkillRow key={gap.skillId} gap={gap} />)}</div> : <Empty text="No skill requirements are available for this profile yet." />}</article>
          </div>
          <article className="panel recommendations-panel"><div className="section-header"><div><span className="eyebrow">PERSONALIZED FOR YOU</span><h2>Your next best steps</h2><p className="section-note">Ranked by target skill impact and participation fit</p></div><span className="ai-pill"><Sparkles size={13} /> {aiStatus === "llm" ? "AI explained" : "Evidence based"}</span></div>
            {aiStatus !== "not_needed" && <div className={`ai-status ai-status-${aiStatus}`} role="status"><span>{aiStatus === "loading" ? "AI is preparing explanations..." : aiStatus === "llm" ? "AI explanations are ready." : aiStatus === "partial" ? "Some AI explanations are unavailable. Remaining steps use rule-based explanations." : aiStatus === "not_configured" ? "AI unavailable: server key is not configured. Showing rule-based explanations." : "AI unavailable. Showing rule-based explanations."}</span>{aiStatus !== "loading" && <button className="icon-button" title="Retry AI explanations" aria-label="Retry AI explanations" onClick={retryAi}><RefreshCw size={16} /></button>}</div>}
            {view.targetStatus === "needs_career_goal" ? <Empty text="You're at the highest grade in this role. Add a career goal to discover cross-role development steps." /> : view.recommendations.length ? <div className="recommendation-list">{view.recommendations.map((recommendation, index) => <RecommendationCard key={recommendation.eventId} recommendation={recommendation} rank={index + 1} dataset={dataset} onComplete={() => complete(recommendation)} />)}</div> : <div className="no-recs"><span className="empty-icon"><Check size={19} /></span><strong>You're up to date</strong><p>There are no eligible activities that close a current target skill gap.</p></div>}
          </article>
        </section>
        <div className="footnote"><span><Sparkles size={13} /> Recommendations are ranked using role requirements, skill impact, availability and your activity history.</span><span>Snapshot date · 01 Oct 2026</span></div>
      </> : <Empty text="No employee profiles found. Import an employee dataset to get started." />}
    </main> : <HrDashboard summary={hr} dataset={dataset} onSelect={(id) => { setEmployeeId(id); setScreen("employee"); }} />}
    {importOpen && <ImportDialog dataset={dataset} onClose={() => setImportOpen(false)} onImport={importData} />}
  </div>;
}

function SkillRow({ gap }: { gap: EmployeeView["skillGaps"][number] }) {
  const currentPct = Math.min(100, gap.currentLevel / 5 * 100);
  const targetPct = Math.min(100, gap.requiredLevel / 5 * 100);
  const effectivePct = Math.min(100, gap.projectedLevel / 5 * 100);
  return <div className="skill-row"><div className="skill-title"><span>{gap.name}{gap.critical && <span className="critical-dot" title="Critical skill for the target grade" />}</span><span className={`gap-badge ${gap.gap ? "gap-open" : "gap-met"}`}>{gap.gap ? `${gap.gap} level gap` : "On target"}</span></div><div className="skill-track"><span className="track-current" style={{ width: `${currentPct}%` }} /><span className="track-effective" style={{ left: `${effectivePct}%` }} /><span className="track-target" style={{ left: `${targetPct}%` }} /></div><div className="skill-values"><span>Current <b>{gap.currentLevel}</b>{gap.projectedLevel !== gap.currentLevel && <> · Effective <b>{gap.projectedLevel}</b></>}</span><span>Target <b>{gap.requiredLevel}</b></span></div></div>;
}

function RecommendationCard({ recommendation, rank, dataset, onComplete }: { recommendation: Recommendation; rank: number; dataset: CareerDataset; onComplete: () => void }) {
  const event = dataset.events.find((item) => item.event_id === recommendation.eventId);
  const impact = recommendation.expectedChanges.filter((change) => change.after > change.before).slice(0, 2);
  return <div className={`recommendation-card ${rank === 1 ? "top-recommendation" : ""}`}><div className="rec-topline"><span className="rec-rank">0{rank}</span><span className="score">{recommendation.score}<small> MATCH</small></span></div><h3>{recommendation.title}</h3><div className="rec-meta"><span><Clock3 size={13} />{event?.duration_hours ?? "—"} hours</span><span>{event?.format === "self_paced" ? "Self paced" : recommendation.nextSession ? `Next · ${recommendation.nextSession}` : "Session available"}</span></div>
    {impact.length > 0 && <div className="impact-box"><div className="impact-label">EXPECTED SKILL IMPACT</div>{impact.map((change) => <div className="impact-line" key={change.skillId}><span>{skillName(dataset, change.skillId)}{change.critical && <span className="tiny-critical">Critical</span>}</span><strong>{change.before}<ArrowRight size={13} />{change.after}<small> / {change.required} target</small></strong></div>)}</div>}
    <div className="why-block"><div className="why-heading"><Sparkles size={13} /> {recommendation.explanationSource === "llm" ? "AI EXPLANATION" : "RULE-BASED EXPLANATION"}</div><p className="recommendation-explanation">{recommendation.aiExplanation ?? recommendation.deterministicExplanation}</p><ul>{recommendation.reasons.slice(0, 3).map((reason, index) => <li key={index}>{reason.replaceAll("->", "→")}</li>)}</ul><p className="history-signal"><Activity size={13} />{recommendation.historySignal}</p></div>
    <button className={`button ${rank === 1 ? "button-green" : "button-outline"} complete-button`} onClick={onComplete}><Check size={15} /> Complete activity</button>
  </div>;
}

function HrDashboard({ summary, dataset, onSelect }: { summary: ReturnType<typeof buildHrSummary>; dataset: CareerDataset; onSelect: (id: string) => void }) {
  const total = dataset.history.length; const completed = dataset.history.filter((row) => row.status === "completed").length;
  const participation = total ? Math.round(completed / total * 100) : 0;
  return <main className="page hr-page"><div className="page-heading"><div><div className="eyebrow"><Users size={14} /> PEOPLE INSIGHTS</div><h1>HR overview</h1><p>Spot development needs and where employees need a next step.</p></div><span className="scope-tag"><span /> Team-wide view</span></div>
    <section className="metric-grid"><Metric icon={<Users />} label="Employees in view" value={String(dataset.employees.length)} detail="Across loaded profiles" /><Metric icon={<Target />} label="Open skill gaps" value={String(summary.weakCompetencies.reduce((n, gap) => n + gap.employeesBelowRequirement, 0))} detail="Employee-to-skill gaps" /><Metric icon={<Compass />} label="Need a next step" value={String(summary.employeesWithoutRecommendations.length)} detail="No eligible recommendation" /><Metric icon={<Activity />} label="Completion rate" value={`${participation}%`} detail={`${completed} of ${total} activity records`} /></section>
    <section className="hr-grid"><article className="panel hr-card"><div className="section-header"><div><span className="eyebrow">MOST COMMON GAPS</span><h2>Skills to invest in</h2></div><Layers3 size={18} className="muted-icon" /></div><div className="hr-gap-list">{summary.weakCompetencies.slice(0, 6).map((skill, index) => <div className="hr-gap-row" key={skill.skillId}><span className="gap-index">0{index + 1}</span><strong>{skill.name}</strong><div className="gap-bar"><span style={{ width: `${Math.min(100, skill.employeesBelowRequirement / Math.max(1, dataset.employees.length) * 100)}%` }} /></div><span className="gap-count">{skill.employeesBelowRequirement}<small> people</small></span></div>)}{!summary.weakCompetencies.length && <Empty text="No current skill gaps in this dataset." />}</div></article>
      <article className="panel hr-card"><div className="section-header"><div><span className="eyebrow">FOLLOW UP</span><h2>Employees without a next step</h2></div><span className="count-pill">{summary.employeesWithoutRecommendations.length}</span></div><div className="followup-list">{summary.employeesWithoutRecommendations.slice(0, 6).map((item) => <button className="followup-row" key={item.employeeId} onClick={() => onSelect(item.employeeId)}><span className="avatar small-avatar">{initials(item.fullName)}</span><span className="followup-name"><strong>{item.fullName}</strong><small>{item.employeeId}</small></span><span className="reason-tag">{item.reason === "needs_career_goal" ? "Career goal needed" : "No eligible step"}</span><ArrowUpRight size={15} /></button>)}{!summary.employeesWithoutRecommendations.length && <Empty text="Everyone has at least one available next step." />}</div></article>
      <article className="panel hr-card participation-card"><div className="section-header"><div><span className="eyebrow">ACTIVITY PARTICIPATION</span><h2>Catalog engagement</h2></div><span className="count-pill">{summary.participationByEvent.length} activities</span></div><div className="table-wrap"><table><thead><tr><th>ACTIVITY</th><th>COMPLETED</th><th>IN PROGRESS</th><th>OTHER</th><th>TOTAL</th></tr></thead><tbody>{summary.participationByEvent.slice(0, 7).map((event) => { const done = event.byStatus.completed ?? 0; const inProgress = event.byStatus.in_progress ?? 0; return <tr key={event.eventId}><td><strong>{event.title}</strong><small>{event.eventId}</small></td><td><span className="status-number done">{done}</span></td><td><span className="status-number">{inProgress}</span></td><td>{event.total - done - inProgress}</td><td>{event.total}</td></tr>; })}</tbody></table>{!summary.participationByEvent.length && <Empty text="Activity records will appear here once data is loaded." />}</div></article></section>
    <div className="footnote"><span>Analytics use only the profiles and activity history loaded in this workspace.</span><span>Snapshot date · 01 Oct 2026</span></div>
  </main>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <article className="panel metric-card"><div className="metric-head"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><strong>{value}</strong><small>{detail}</small></article>; }

function ImportDialog({ dataset, onClose, onImport }: { dataset: CareerDataset; onClose: () => void; onImport: (data: CareerDataset, message: string) => void }) {
  const input = useRef<HTMLInputElement>(null); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  async function handle(file?: File) { if (!file) return; setBusy(true); setError(""); try { const text = await file.text(); const next = parseImportText(text, file.name, dataset); onImport(next, `Imported ${file.name}. ${next.employees.length} employee profiles available.`); } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not read this file."); } finally { setBusy(false); } }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="dialog-head"><div><span className="eyebrow">BRING YOUR DATA</span><h2 id="import-title">Import profiles or activity history</h2></div><button className="icon-button" autoFocus aria-label="Close import dialog" onClick={onClose}><X size={18} /></button></div><p className="dialog-copy">Add profiles and history in the project schema. Existing demo catalog and skill requirements remain available when you import profiles.</p><div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void handle(event.dataTransfer.files[0]); }}><CloudUpload size={27} /><strong>{busy ? "Reading your file…" : "Drop a file here, or browse"}</strong><span>JSON or CSV profiles · activity history · complete dataset</span><button className="button button-outline" onClick={() => input.current?.click()} disabled={busy}>Choose file</button><input ref={input} type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => void handle(event.target.files?.[0])} /></div>{error && <div className="import-error" role="alert">{error}</div>}<div className="import-formats"><strong>Accepted formats</strong><p><code>employees.json</code> or <code>{'{ employees: [...], history: [...] }'}</code></p><p><code>activity_history.csv</code> with record_id, employee_id, event_id, date, status, completion_pct, assigned_by; employee CSV files should include skills and career_goal JSON columns if provided.</p><small>A complete dataset may include employees, history, events, skills and roleProfiles; that dataset replaces the demo catalog.</small></div><div className="dialog-foot"><span>Saved locally. Recommendation evidence is processed by the server.</span><button className="button button-dark" onClick={onClose}>Done</button></div></section></div>;
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><span className="empty-icon"><CircleHelp size={18} /></span><p>{text}</p></div>; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function skillName(dataset: CareerDataset, id: string) { return dataset.skills.find((skill) => skill.skill_id === id)?.name ?? id; }

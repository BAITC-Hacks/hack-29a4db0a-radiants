"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, ChevronDown, CircleHelp, Clock3, CloudUpload, Compass, FileUp, Gauge, Layers3, Sparkles, Target, Users, X } from "lucide-react";
import type { EmployeeView, Recommendation } from "../types/career";



import { requestApi } from "../lib/frontend/api";
import type { CatalogResult, CompleteActivityResult, EmployeeDetail, EmployeeListResult, HrSummaryResult, ImportResult } from "../contracts/api";
type WorkspaceData = CatalogResult & { employees: EmployeeListResult["items"] };


export default function App() {
  const [dataset, setDataset] = useState<WorkspaceData | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [view, setView] = useState<EmployeeDetail | null>(null);
  const [hr, setHr] = useState<HrSummaryResult | null>(null);
  const [screen, setScreen] = useState<"employee" | "hr">("employee");
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestApi<CatalogResult>("/api/catalog", { signal: controller.signal }),
      requestApi<EmployeeListResult>("/api/employees", { signal: controller.signal }),
    ]).then(([catalog, employees]) => {
      setDataset({ ...catalog, employees: employees.items });
      setEmployeeId((current) => employees.items.some((item) => item.employeeId === current) ? current : employees.items[0]?.employeeId ?? "");
    }).catch((issue) => { if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : "Could not load workspace"); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!employeeId) return;
    const controller = new AbortController();
    requestApi<EmployeeDetail>("/api/employees/" + encodeURIComponent(employeeId) + "/recommendations", { signal: controller.signal })
      .then(setView).catch((issue) => { if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : "Could not load profile"); });
    return () => controller.abort();
  }, [employeeId, revision]);

  useEffect(() => {
    if (screen !== "hr") return;
    const controller = new AbortController();
    requestApi<HrSummaryResult>("/api/hr/summary", { signal: controller.signal })
      .then(setHr).catch((issue) => { if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : "Could not load HR summary"); });
    return () => controller.abort();
  }, [screen, revision]);

  async function complete(recommendation: Recommendation) {
    if (!view || busy) return;
    setBusy(true); setError("");
    try {
      const result = await requestApi<CompleteActivityResult>("/api/employees/" + encodeURIComponent(employeeId) + "/activities/" + encodeURIComponent(recommendation.eventId) + "/complete", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      setView(result.view);
      const impact = recommendation.expectedChanges.filter((change) => change.after > change.before).map((change) => (dataset ? skillName(dataset, change.skillId) : change.skillId) + " " + change.before + " → " + change.after).join(", ");
      setNotice("Activity completed. Readiness " + result.progress.before + "% → " + result.progress.after + "% (" + (result.progress.delta >= 0 ? "+" : "") + result.progress.delta + "). " + impact);
      setHr(null); setRevision((value) => value + 1);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Completion failed"); }
    finally { setBusy(false); }
  }

  async function importData(files: File[]) {
    const form = new FormData();
    for (const file of files) {
      const field = file.name.toLowerCase().endsWith(".csv") ? "history" : "employees";
      if (form.has(field)) throw new Error("Choose at most one employee JSON and one history CSV.");
      form.set(field, file);
    }
    const result = await requestApi<ImportResult>("/api/import", { method: "POST", body: form });
    setNotice("Imported: " + result.employeesInserted + " new profiles, " + result.employeesUpdated + " updated, " + result.historyInserted + " history records.");
    setHr(null); setView(null); setRevision((value) => value + 1); setImportOpen(false);
  }

  if (!dataset) return <main className="page"><h1>Career Quest</h1><p role={error ? "alert" : "status"}>{error || "Loading employee workspace…"}</p>{error && <button onClick={() => { setError(""); setRevision((value) => value + 1); }}>Retry</button>}</main>;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setScreen("employee"); }}><span className="brand-mark"><Compass size={19} /></span><span>career<span className="brand-light">quest</span></span></a>
      <div className="topbar-right">
        <span className="demo-tag"><span /> Demo workspace</span>
        <button className={`nav-link ${screen === "employee" ? "selected" : ""}`} disabled={busy} onClick={() => setScreen("employee")}><BriefcaseBusiness size={16} /> Employee view</button>
        <button className={`nav-link ${screen === "hr" ? "selected" : ""}`} disabled={busy} onClick={() => setScreen("hr")}><Users size={16} /> HR overview</button>
        <button className="button button-dark top-import" disabled={busy} onClick={() => setImportOpen(true)}><FileUp size={16} /> Import data</button>
      </div>
    </header>
    {error && <div className="import-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}
    {screen === "employee" ? <main className="page">
      <div className="page-heading"><div><div className="eyebrow"><Sparkles size={14} /> PEOPLE DEVELOPMENT</div><h1>Growth, with direction.</h1><p>A clear next step, grounded in real skills and experience.</p></div>
        <label className="select-wrap" htmlFor="employee-select"><span className="sr-only">Select employee</span><select id="employee-select" value={employeeId} disabled={busy} onChange={(event) => { setView(null); setEmployeeId(event.target.value); }}>{dataset.employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.fullName} · {employee.role}</option>)}</select><ChevronDown size={16} /></label>
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
          <article className="panel recommendations-panel"><div className="section-header"><div><span className="eyebrow">PERSONALIZED FOR YOU</span><h2>Your next best steps</h2><p className="section-note">Ranked by target skill impact and participation fit</p></div><span className="ai-pill"><Sparkles size={13} /> Evidence based</span></div>
            {view.targetStatus === "needs_career_goal" ? <Empty text="You're at the highest grade in this role. Add a career goal to discover cross-role development steps." /> : view.recommendations.length ? <div className="recommendation-list">{view.recommendations.map((recommendation, index) => <RecommendationCard key={recommendation.eventId} recommendation={recommendation} rank={index + 1} dataset={dataset} busy={busy} onComplete={() => void complete(recommendation)} />)}</div> : <div className="no-recs"><span className="empty-icon"><Check size={19} /></span><strong>You're up to date</strong><p>There are no eligible activities that close a current target skill gap.</p></div>}
          </article>
        </section>
        <div className="footnote"><span><Sparkles size={13} /> Recommendations are ranked using role requirements, skill impact, availability and your activity history.</span><span>Snapshot date · 01 Oct 2026</span></div>
      </> : <Empty text={employeeId ? "Loading employee profile…" : "No employee profiles found. Import an employee dataset to get started."} />}
    </main> : hr ? <HrDashboard summary={hr} onSelect={(id) => { if (id !== employeeId) setView(null); setEmployeeId(id); setScreen("employee"); }} /> : <main className="page"><Empty text="Loading HR summary…" /></main>}
    {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImport={importData} />}
  </div>;
}

function SkillRow({ gap }: { gap: EmployeeView["skillGaps"][number] }) {
  const currentPct = Math.min(100, gap.currentLevel / 5 * 100);
  const targetPct = Math.min(100, gap.requiredLevel / 5 * 100);
  const effectivePct = Math.min(100, gap.projectedLevel / 5 * 100);
  return <div className="skill-row"><div className="skill-title"><span>{gap.name}{gap.critical && <span className="critical-dot" title="Critical skill for the target grade" />}</span><span className={`gap-badge ${gap.gap ? "gap-open" : "gap-met"}`}>{gap.gap ? `${gap.gap} level gap` : "On target"}</span></div><div className="skill-track"><span className="track-current" style={{ width: `${currentPct}%` }} /><span className="track-effective" style={{ left: `${effectivePct}%` }} /><span className="track-target" style={{ left: `${targetPct}%` }} /></div><div className="skill-values"><span>Current <b>{gap.currentLevel}</b>{gap.projectedLevel !== gap.currentLevel && <> · Effective <b>{gap.projectedLevel}</b></>}</span><span>Target <b>{gap.requiredLevel}</b></span></div></div>;
}

function RecommendationCard({ recommendation, rank, dataset, busy, onComplete }: { recommendation: Recommendation; rank: number; dataset: CatalogResult; busy: boolean; onComplete: () => void }) {
  const event = dataset.events.find((item) => item.event_id === recommendation.eventId);
  const impact = recommendation.expectedChanges.filter((change) => change.after > change.before).slice(0, 2);
  return <div className={`recommendation-card ${rank === 1 ? "top-recommendation" : ""}`}><div className="rec-topline"><span className="rec-rank">0{rank}</span><span className="score">{recommendation.score}<small> MATCH</small></span></div><h3>{recommendation.title}</h3><div className="rec-meta"><span><Clock3 size={13} />{event?.duration_hours ?? "—"} hours</span><span>{event?.format === "self_paced" ? "Self paced" : recommendation.nextSession ? `Next · ${recommendation.nextSession}` : "Session available"}</span></div>
    {impact.length > 0 && <div className="impact-box"><div className="impact-label">EXPECTED SKILL IMPACT</div>{impact.map((change) => <div className="impact-line" key={change.skillId}><span>{skillName(dataset, change.skillId)}{change.critical && <span className="tiny-critical">Critical</span>}</span><strong>{change.before}<ArrowRight size={13} />{change.after}<small> / {change.required} target</small></strong></div>)}</div>}
    <div className="why-block"><div className="why-heading"><Sparkles size={13} /> WHY THIS STEP</div><ul>{recommendation.reasons.slice(0, 3).map((reason, index) => <li key={index}>{reason.replaceAll("->", "→")}</li>)}</ul><p className="history-signal"><Activity size={13} />{recommendation.historySignal}</p></div>
    <p className="section-note">{recommendation.aiExplanation ?? recommendation.deterministicExplanation}</p>
    <button className={`button ${rank === 1 ? "button-green" : "button-outline"} complete-button`} disabled={busy} onClick={onComplete}><Check size={15} /> Complete activity</button>
  </div>;
}

function HrDashboard({ summary, onSelect }: { summary: HrSummaryResult; onSelect: (id: string) => void }) {
  const total = summary.totalActivities; const completed = summary.participationByStatus.completed;
  const participation = total ? Math.round(completed / total * 100) : 0;
  return <main className="page hr-page"><div className="page-heading"><div><div className="eyebrow"><Users size={14} /> PEOPLE INSIGHTS</div><h1>HR overview</h1><p>Spot development needs and where employees need a next step.</p></div><span className="scope-tag"><span /> Team-wide view</span></div>
    <section className="metric-grid"><Metric icon={<Users />} label="Employees in view" value={String(summary.population)} detail="Across loaded profiles" /><Metric icon={<Target />} label="Open skill gaps" value={String(summary.weakCompetencies.reduce((n, gap) => n + gap.employeesBelowRequirement, 0))} detail="Employee-to-skill gaps" /><Metric icon={<Compass />} label="Need a next step" value={String(summary.employeesWithoutRecommendations.length)} detail="No eligible recommendation" /><Metric icon={<Activity />} label="Completion rate" value={`${participation}%`} detail={`${completed} of ${total} activity records`} /></section>
    <section className="hr-grid"><article className="panel hr-card"><div className="section-header"><div><span className="eyebrow">MOST COMMON GAPS</span><h2>Skills to invest in</h2></div><Layers3 size={18} className="muted-icon" /></div><div className="hr-gap-list">{summary.weakCompetencies.map((skill, index) => <div className="hr-gap-row" key={skill.skillId}><span className="gap-index">0{index + 1}</span><strong>{skill.name}</strong><div className="gap-bar"><span style={{ width: `${Math.min(100, skill.employeesBelowRequirement / Math.max(1, summary.population) * 100)}%` }} /></div><span className="gap-count">{skill.employeesBelowRequirement}<small> people</small></span></div>)}{!summary.weakCompetencies.length && <Empty text="No current skill gaps in this dataset." />}</div></article>
      <article className="panel hr-card"><div className="section-header"><div><span className="eyebrow">FOLLOW UP</span><h2>Employees without a next step</h2></div><span className="count-pill">{summary.employeesWithoutRecommendations.length}</span></div><div className="followup-list">{summary.employeesWithoutRecommendations.map((item) => <button className="followup-row" key={item.employeeId} onClick={() => onSelect(item.employeeId)}><span className="avatar small-avatar">{initials(item.fullName)}</span><span className="followup-name"><strong>{item.fullName}</strong><small>{item.employeeId}</small></span><span className="reason-tag">{item.reason === "needs_career_goal" ? "Career goal needed" : "No eligible step"}</span><ArrowUpRight size={15} /></button>)}{!summary.employeesWithoutRecommendations.length && <Empty text="Everyone has at least one available next step." />}</div></article>
      <article className="panel hr-card participation-card"><div className="section-header"><div><span className="eyebrow">ACTIVITY PARTICIPATION</span><h2>Catalog engagement</h2></div><span className="count-pill">{summary.participationByEvent.length} activities</span></div><div className="table-wrap"><table><thead><tr><th>ACTIVITY</th><th>COMPLETED</th><th>IN PROGRESS</th><th>OTHER</th><th>TOTAL</th></tr></thead><tbody>{summary.participationByEvent.map((event) => { const done = event.byStatus.completed ?? 0; const inProgress = event.byStatus.in_progress ?? 0; return <tr key={event.eventId}><td><strong>{event.title}</strong><small>{event.eventId}</small></td><td><span className="status-number done">{done}</span></td><td><span className="status-number">{inProgress}</span></td><td>{event.total - done - inProgress}</td><td>{event.total}</td></tr>; })}</tbody></table>{!summary.participationByEvent.length && <Empty text="Activity records will appear here once data is loaded." />}</div></article></section>
    <div className="footnote"><span>Analytics use only the profiles and activity history loaded in this workspace.</span><span>Snapshot date · 01 Oct 2026</span></div>
  </main>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <article className="panel metric-card"><div className="metric-head"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span></div><strong>{value}</strong><small>{detail}</small></article>; }

function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (files: File[]) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, busy]);
  async function handle(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true); setError("");
    try { await onImport(files); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="dialog-head"><div><span className="eyebrow">BRING YOUR DATA</span><h2 id="import-title">Import profiles or activity history</h2></div><button className="icon-button" autoFocus disabled={busy} aria-label="Close import dialog" onClick={onClose}><X size={18} /></button></div>
      <p className="dialog-copy">Add employees and history to the official catalog. Select both files together when history belongs to new employees.</p>
      <div className={"dropzone " + (dragging ? "dragging" : "")} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void handle(Array.from(event.dataTransfer.files)); }}>
        <CloudUpload size={27} /><strong>{busy ? "Importing…" : "Drop files here, or browse"}</strong><span>Employee JSON · activity history CSV</span>
        <button className="button button-outline" onClick={() => input.current?.click()} disabled={busy}>Choose files</button>
        <input ref={input} type="file" multiple accept=".json,.csv,application/json,text/csv" onChange={(event) => void handle(Array.from(event.target.files ?? []))} />
      </div>
      {error && <div className="import-error" role="alert">{error}</div>}
      <div className="import-formats"><strong>Accepted formats</strong><p><code>employees.json</code>: one employee, an array, or <code>{'{ meta, employees: [...] }'}</code>.</p><p><code>activity_history.csv</code>: official history columns.</p><small>If any row is invalid, the entire import is rolled back. Duplicate history records are skipped.</small></div>
      <div className="dialog-foot"><span>Changes are saved to the shared workspace.</span><button className="button button-dark" disabled={busy} onClick={onClose}>Done</button></div>
    </section>
  </div>;
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><span className="empty-icon"><CircleHelp size={18} /></span><p>{text}</p></div>; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function skillName(dataset: CatalogResult, id: string) { return dataset.skills.find((skill) => skill.skill_id === id)?.name ?? id; }

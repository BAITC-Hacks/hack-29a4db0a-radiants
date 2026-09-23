"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp } from "lucide-react";
import type { Recommendation } from "../types/career";
import type { EmployeeDetail } from "../contracts/api";
import type { AuthSession } from "../contracts/auth";
import { CompletionError, type CareerApi, type ImportResult } from "../lib/frontend/api";
import { useApiResource } from "../hooks/useApiResource";
import { useAiRecommendations } from "../hooks/useAiRecommendations";
import { EmployeeScreen, type CompletionSnapshot } from "./EmployeeScreen";
import { HRDashboard } from "./HRDashboard";
import { ImportDialog } from "./ImportDialog";
import { EmptyState, ErrorState, LoadingState } from "./States";

export default function App({ api, session, onSignOut }: { api: CareerApi; session: AuthSession; onSignOut: () => void }) {
  const isHr = session.user.role === "hr";
  const [employeeId, setEmployeeId] = useState(session.user.employeeId ?? "");
  const [screen, setScreen] = useState<"employee" | "hr">("employee");
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [completion, setCompletion] = useState<CompletionSnapshot | null>(null);
  const [failure, setFailure] = useState<{ before: EmployeeDetail; error: CompletionError } | null>(null);
  const mutationLock = useRef(false);
  const selected = useRef(employeeId);
  selected.current = employeeId;

  const listLoader = useCallback((signal: AbortSignal) => api.getEmployees(signal), [api]);
  const catalogLoader = useCallback((signal: AbortSignal) => api.getCatalog(signal), [api]);
  const viewLoader = useCallback((signal: AbortSignal) => api.getEmployeeView(employeeId, signal), [api, employeeId]);
  const hrLoader = useCallback((signal: AbortSignal) => api.getHrSummary(signal), [api]);
  const employees = useApiResource("employees", listLoader);
  const catalog = useApiResource("catalog", catalogLoader);
  const skillNames = useMemo(() => Object.fromEntries(catalog.data?.skills.map((skill) => [skill.skill_id, skill.name]) ?? []), [catalog.data]);
  const profile = useApiResource(employeeId, viewLoader, !!employeeId && screen === "employee");
  const hr = useApiResource("hr", hrLoader, isHr && screen === "hr");
  const ai = useAiRecommendations(api, profile.data, screen === "employee" && !importOpen &&
    !profile.loading && !profile.error && pending === null && failure?.before.employee.employee_id !== employeeId);

  useEffect(() => {
    if (!employeeId && employees.data?.length) setEmployeeId(employees.data[0]!.employee_id);
  }, [employeeId, employees.data]);

  async function complete(recommendation: Recommendation) {
    const before = profile.data;
    if (!before || mutationLock.current || session.user.role !== "employee" || session.user.employeeId !== before.employee.employee_id) return;
    ai.cancel();
    mutationLock.current = true;
    setPending(before.employee.employee_id);
    setFailure(null);
    setCompletion(null);
    try {
      const after = await api.completeActivity(before.employee.employee_id, recommendation.eventId);
      if (selected.current === before.employee.employee_id) profile.replace(after);
      setCompletion({ before, after });
      hr.reload();
    } catch (error) {
      setFailure({ before, error: error instanceof CompletionError ? error :
        new CompletionError("Could not confirm completion. Reload the profile before trying again.", "unknown") });
    } finally {
      mutationLock.current = false;
      setPending(null);
    }
  }

  async function refreshAfterCompletion() {
    if (!failure || mutationLock.current) return;
    const saved = failure;
    ai.cancel();
    mutationLock.current = true;
    setPending(saved.before.employee.employee_id);
    try {
      const after = await api.getEmployeeView(saved.before.employee.employee_id);
      if (selected.current === after.employee.employee_id) profile.replace(after);
      if (saved.error.phase === "refresh") setCompletion({ before: saved.before, after });
      setFailure(null);
      hr.reload();
    } catch (error) {
      setFailure({ ...saved, error: new CompletionError(
        error instanceof Error ? error.message : "Could not refresh the profile.", saved.error.phase) });
    } finally {
      mutationLock.current = false;
      setPending(null);
    }
  }

  async function imported(result: ImportResult) {
    ai.cancel();
    const refreshed = await api.getEmployees();
    const knownIds = new Set(employees.data?.map((employee) => employee.employee_id) ?? []);
    const id = result.employeeIds?.find((candidate) => refreshed.some((employee) => employee.employee_id === candidate)) ??
      refreshed.find((employee) => !knownIds.has(employee.employee_id))?.employee_id ??
      refreshed.find((employee) => employee.employee_id === selected.current)?.employee_id ??
      refreshed[0]?.employee_id ?? "";
    employees.replace(refreshed);
    setEmployeeId(id);
    if (id === selected.current) profile.reload();
    setCompletion(null);
    setFailure(null);
    hr.reload();
    setScreen("employee");
    setImportNotice(result.message || "Import completed. Employee profiles refreshed.");
  }
  const closeImport = useCallback(() => setImportOpen(false), []);
  const currentFailure = failure?.before.employee.employee_id === employeeId ? failure : null;
  const currentCompletion = completion?.after.employee.employee_id === employeeId ? completion : null;
  function showScreen(next: "employee" | "hr") {
    if (next === "hr" && !isHr) return;
    if (next !== screen) ai.cancel();
    setScreen(next);
  }
  function selectEmployee(id: string) {
    if (!isHr && id !== session.user.employeeId) return;
    ai.cancel();
    selected.current = id;
    setEmployeeId(id);
    setImportNotice("");
    setScreen("employee");
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); showScreen("employee"); }}>
        <span>Career Quest</span><span className="brand-caption">Employee development</span>
      </a>
      <nav className="topbar-right" aria-label="Workspace">
        <button className={`nav-link ${screen === "employee" ? "selected" : ""}`} aria-label="Employee view" aria-current={screen === "employee" ? "page" : undefined} onClick={() => showScreen("employee")}>Employee</button>
        {isHr && <button className={`nav-link ${screen === "hr" ? "selected" : ""}`} aria-label="HR overview" aria-current={screen === "hr" ? "page" : undefined} onClick={() => showScreen("hr")}>HR dashboard</button>}
        {isHr && <button className="button button-outline top-import" aria-label="Import data" disabled={pending !== null} onClick={() => { ai.cancel(); setImportNotice(""); setImportOpen(true); }}><FileUp size={16} /> Import</button>}
        <span className="session-label">{session.user.username} · {isHr ? "HR" : "Employee"}</span>
        <button className="button button-outline" onClick={() => { ai.cancel(); onSignOut(); }}>Sign out</button>
      </nav>
    </header>
    {screen === "employee" ? <main className="page">
      <div className="page-heading">
        <div><h1>Development plan</h1><p>Review skills, career targets and recommended activities.</p></div>
        {isHr && <label className="select-wrap" htmlFor="employee-select">
          <span className="select-label">Employee</span>
          <select id="employee-select" aria-label="Select employee" value={employeeId} disabled={employees.loading || !employees.data?.length} onChange={(event) => selectEmployee(event.target.value)}>
            {!employeeId && <option value="">{employees.loading ? "Loading employees…" : "Select employee"}</option>}
            {employees.data?.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name || employee.employee_id} · {employee.role}</option>)}
          </select><ChevronDown size={16} />
        </label>}
      </div>
      <p className="section-note privacy-note">{isHr ? "Authorized HR view. Activity completion is recorded by the employee in their own account." : "Your development profile is visible to you and authorized HR staff. Recommended development activities are voluntary."}</p>
      {importNotice && <div className="inline-success" role="status">{importNotice}</div>}
      {ai.status === "loading" && <p className="section-note" role="status">Preparing AI explanations… Your plan is ready to use.</p>}
      {ai.status === "fallback" && <div className="ai-retry"><p className="section-note" role="status">Showing evidence-based explanations. AI explanations are currently unavailable.</p><button className="button button-outline" onClick={ai.retry}>Retry AI explanations</button></div>}
      {employees.error ? <ErrorState title="Could not load employees." detail={employees.error} onRetry={employees.reload} /> :
        employees.loading ? <LoadingState text="Loading employees…" /> :
        !employees.data?.length ? <EmptyState text={isHr ? "No employee profiles are available. Import a profile to get started." : "Your employee profile is unavailable. Contact the application operator."} /> :
        profile.error ? <ErrorState title="Could not load employee profile and recommendations." detail={profile.error} onRetry={profile.reload} /> :
        profile.loading || !profile.data ? <LoadingState text="Analyzing your development profile…" /> :
        <EmployeeScreen view={ai.view ?? profile.data} skillNames={skillNames} allowCompletion={!isHr && session.user.employeeId === employeeId} completion={currentCompletion} onDismissCompletion={() => setCompletion(null)}
          completing={pending === employeeId} completionDisabled={pending !== null || !!currentFailure && currentFailure.error.phase !== "rejected"}
          failure={currentFailure?.error ?? null} onRefresh={() => void refreshAfterCompletion()}
          onComplete={(recommendation) => void complete(recommendation)} />}
    </main> : <main className="page hr-page">
      <div className="page-heading"><div><h1>HR dashboard</h1><p>Skill gaps, employees needing follow-up and activity participation.</p></div></div>
      {hr.error ? <ErrorState title="Could not load HR summary." detail={hr.error} onRetry={hr.reload} /> :
        hr.loading || !hr.data ? <LoadingState text="Loading HR summary…" /> :
        <HRDashboard summary={hr.data} onSelect={selectEmployee} />}
    </main>}
    {isHr && importOpen && <ImportDialog api={api} onClose={closeImport} onImported={imported} />}
  </div>;
}

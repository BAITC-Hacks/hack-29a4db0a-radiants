"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileUp } from "lucide-react";
import type { EmployeeView, Recommendation } from "../types/career";
import { CompletionError, createCareerApi, type CareerApi, type ImportResult } from "../lib/frontend/api";
import { useApiResource } from "../hooks/useApiResource";
import { useRecommendations } from "../hooks/useRecommendations";
import { EmployeeScreen, type CompletionSnapshot } from "./EmployeeScreen";
import { HRDashboard } from "./HRDashboard";
import { ImportDialog } from "./ImportDialog";
import { EmptyState, ErrorState, LoadingState } from "./States";

const defaultApi = createCareerApi();
export default function App({ api = defaultApi }: { api?: CareerApi }) {
  const [employeeId, setEmployeeId] = useState("");
  const [screen, setScreen] = useState<"employee" | "hr">("employee");
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [completion, setCompletion] = useState<CompletionSnapshot | null>(null);
  const [failure, setFailure] = useState<{ before: EmployeeView; error: CompletionError } | null>(null);
  const mutationLock = useRef(false);
  const selected = useRef(employeeId);
  selected.current = employeeId;

  const listLoader = useCallback((signal: AbortSignal) => api.getEmployees(signal), [api]);
  const viewLoader = useCallback((signal: AbortSignal) => api.getEmployeeView(employeeId, signal), [api, employeeId]);
  const hrLoader = useCallback((signal: AbortSignal) => api.getHrSummary(signal), [api]);
  const catalogLoader = useCallback((signal: AbortSignal) => api.getCatalog(signal), [api]);
  const employees = useApiResource("employees", listLoader);
  const profile = useApiResource(employeeId, viewLoader, !!employeeId && screen === "employee");
  const hr = useApiResource("hr", hrLoader, screen === "hr");
  const catalog = useApiResource("catalog", catalogLoader);
  const recommendations = useRecommendations(api, employeeId, profile.version,
    !!profile.data && !profile.loading && !profile.error && screen === "employee" && !pending && !importing &&
    !(failure?.before.employee.employee_id === employeeId && failure.error.phase !== "rejected"));

  function selectEmployee(id: string) {
    recommendations.cancel();
    selected.current = id;
    setEmployeeId(id);
    setImportNotice("");
    setCompletion(null);
    setFailure(null);
  }
  function refreshProfile() { recommendations.cancel(); profile.reload(); }
  function startImport() {
    recommendations.cancel();
    mutationLock.current = true;
    setImporting(true);
  }
  function finishImport() {
    // Even an uncertain upload outcome requires a fresh profile before AI resumes.
    profile.reload();
    employees.reload();
    mutationLock.current = false;
    setImporting(false);
  }

  useEffect(() => {
    if (!employeeId && employees.data?.length) setEmployeeId(employees.data[0]!.employee_id);
  }, [employeeId, employees.data]);

  async function complete(recommendation: Recommendation) {
    const before = profile.data;
    if (!before || mutationLock.current) return;
    recommendations.cancel();
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
    recommendations.cancel();
    const saved = failure;
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
    const refreshed = await api.getEmployees();
    const knownIds = new Set(employees.data?.map((employee) => employee.employee_id) ?? []);
    const id = result.employeeIds?.find((candidate) => refreshed.some((employee) => employee.employee_id === candidate)) ??
      refreshed.find((employee) => !knownIds.has(employee.employee_id))?.employee_id ??
      refreshed.find((employee) => employee.employee_id === selected.current)?.employee_id ??
      refreshed[0]?.employee_id ?? "";
    employees.replace(refreshed);
    selectEmployee(id);
    setCompletion(null);
    setFailure(null);
    hr.reload();
    setScreen("employee");
    setImportNotice(result.message || "Import completed. Employee profiles refreshed.");
  }
  const closeImport = useCallback(() => setImportOpen(false), []);
  const currentFailure = failure?.before.employee.employee_id === employeeId ? failure : null;
  const currentCompletion = completion?.after.employee.employee_id === employeeId ? completion : null;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setScreen("employee"); }}>
        <span>Career Quest</span><span className="brand-caption">Employee development</span>
      </a>
      <nav className="topbar-right" aria-label="Workspace">
        <button className={`nav-link ${screen === "employee" ? "selected" : ""}`} aria-label="Employee view" aria-current={screen === "employee" ? "page" : undefined} onClick={() => setScreen("employee")}>Employee</button>
        <button className={`nav-link ${screen === "hr" ? "selected" : ""}`} aria-label="HR overview" aria-current={screen === "hr" ? "page" : undefined} onClick={() => { recommendations.cancel(); setScreen("hr"); }}>HR dashboard</button>
        <button className="button button-outline top-import" aria-label="Import data" disabled={pending !== null} onClick={() => { setImportNotice(""); setImportOpen(true); }}><FileUp size={16} /> Import</button>
      </nav>
    </header>
    {screen === "employee" ? <main className="page">
      <div className="page-heading">
        <div><h1>Development plan</h1><p>Review skills, career targets and recommended activities.</p></div>
        <label className="select-wrap" htmlFor="employee-select">
          <span className="select-label">Employee</span>
          <select id="employee-select" aria-label="Select employee" value={employeeId} disabled={employees.loading || !employees.data?.length} onChange={(event) => selectEmployee(event.target.value)}>
            {!employeeId && <option value="">{employees.loading ? "Loading employees…" : "Select employee"}</option>}
            {employees.data?.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name || employee.employee_id} · {employee.role}</option>)}
          </select><ChevronDown size={16} />
        </label>
      </div>
      {importNotice && <div className="inline-success" role="status">{importNotice}</div>}
      {profile.data && profile.error && <ErrorState title="Could not refresh this profile." detail={profile.error} onRetry={refreshProfile} />}
      {employees.error && employees.data && <ErrorState title="Could not refresh employees." detail={employees.error} onRetry={employees.reload} />}
      {employees.error && !employees.data ? <ErrorState title="Could not load employees." detail={employees.error} onRetry={employees.reload} /> :
        employees.loading && !employees.data ? <LoadingState text="Loading employees…" /> :
        !employees.data?.length ? <EmptyState text="No employee profiles are available. Import a profile to get started." /> :
        profile.error && !profile.data ? <ErrorState title="Could not load employee profile." detail={profile.error} onRetry={refreshProfile} /> :
        !profile.data ? <LoadingState text="Loading employee profile…" /> :
        <EmployeeScreen view={profile.data} catalog={catalog.data} catalogError={catalog.error} onRetryCatalog={catalog.reload}
          recommendations={pending || importing || profile.loading || profile.error || currentFailure && currentFailure.error.phase !== "rejected" ? [] : recommendations.data ?? profile.data.recommendations}
          recommendationsLoading={recommendations.loading || importing || !!pending || profile.loading}
          recommendationsError={recommendations.error} onRetryRecommendations={recommendations.retry}
          completion={currentCompletion} onDismissCompletion={() => setCompletion(null)}
          completing={pending === employeeId} completionDisabled={pending !== null || importing || profile.loading || !!profile.error || !!currentFailure && currentFailure.error.phase !== "rejected"}
          failure={currentFailure?.error ?? null} onRefresh={() => void refreshAfterCompletion()}
          onComplete={(recommendation) => void complete(recommendation)} />}
    </main> : <main className="page hr-page">
      <div className="page-heading"><div><h1>HR dashboard</h1><p>Skill gaps, employees needing follow-up and activity participation.</p></div></div>
      {hr.error ? <ErrorState title="Could not load HR summary." detail={hr.error} onRetry={hr.reload} /> :
        hr.loading || !hr.data ? <LoadingState text="Loading HR summary…" /> :
        <HRDashboard summary={hr.data} onSelect={(id) => { selectEmployee(id); setScreen("employee"); }} />}
    </main>}
    {importOpen && <ImportDialog api={api} onClose={closeImport} onImported={imported} onImportStart={startImport} onImportEnd={finishImport} />}
  </div>;
}

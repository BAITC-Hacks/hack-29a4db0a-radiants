"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp } from "lucide-react";
import type { Recommendation } from "../types/career";
import type { EmployeeDetail } from "../contracts/api";
import { CompletionError, createCareerApi, type CareerApi, type ImportResult } from "../lib/frontend/api";
import { useApiResource } from "../hooks/useApiResource";
import { useAiRecommendations } from "../hooks/useAiRecommendations";
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
  const hr = useApiResource("hr", hrLoader, screen === "hr");
  const ai = useAiRecommendations(api, profile.data, screen === "employee" && !importOpen &&
    !profile.loading && !profile.error && pending === null && failure?.before.employee.employee_id !== employeeId);

  useEffect(() => {
    if (!employeeId && employees.data?.length) setEmployeeId(employees.data[0]!.employee_id);
  }, [employeeId, employees.data]);

  async function complete(recommendation: Recommendation) {
    const before = profile.data;
    if (!before || mutationLock.current) return;
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
        new CompletionError("Не удалось подтвердить завершение. Обновите профиль перед повторной попыткой.", "unknown") });
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
        error instanceof Error ? error.message : "Не удалось обновить профиль.", saved.error.phase) });
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
    setImportNotice(result.message || "Данные загружены. Профили обновлены.");
  }
  const closeImport = useCallback(() => setImportOpen(false), []);
  const currentFailure = failure?.before.employee.employee_id === employeeId ? failure : null;
  const currentCompletion = completion?.after.employee.employee_id === employeeId ? completion : null;
  function showScreen(next: "employee" | "hr") {
    if (next !== screen) ai.cancel();
    setScreen(next);
  }
  function selectEmployee(id: string) {
    ai.cancel();
    selected.current = id;
    setEmployeeId(id);
    setImportNotice("");
    setScreen("employee");
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#home" aria-label="Career Quest — развитие сотрудников" onClick={(event) => { event.preventDefault(); showScreen("employee"); }}>
          <span className="brand-caption">Career Quest<span>Развитие сотрудников</span></span>
        </a>
        <nav className="topbar-nav" aria-label="Разделы">
          <button className={`nav-link ${screen === "employee" ? "selected" : ""}`} aria-current={screen === "employee" ? "page" : undefined} onClick={() => showScreen("employee")}>Развитие</button>
          <button className={`nav-link ${screen === "hr" ? "selected" : ""}`} aria-current={screen === "hr" ? "page" : undefined} onClick={() => showScreen("hr")}>Обзор команды</button>
        </nav>
        <button className="button button-outline top-import" disabled={pending !== null} onClick={() => { ai.cancel(); setImportNotice(""); setImportOpen(true); }}><FileUp size={18} /> Загрузить данные</button>
      </div>
    </header>
    {screen === "employee" ? <main id="main-content" className="page" tabIndex={-1}>
      <div className="page-heading">
        <div><h1>План развития</h1><p>Ваша цель, навыки и следующий шаг.</p></div>
        <label className="select-wrap" htmlFor="employee-select">
          <span className="select-label">Сотрудник</span>
          <select id="employee-select" value={employeeId} disabled={employees.loading || !employees.data?.length} onChange={(event) => selectEmployee(event.target.value)}>
            {!employeeId && <option value="">{employees.loading ? "Загружаем список…" : "Выберите сотрудника"}</option>}
            {employees.data?.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name || employee.employee_id} · {employee.role}</option>)}
          </select><ChevronDown size={16} />
        </label>
      </div>
      {importNotice && <div className="inline-success" role="status">{importNotice}</div>}
      {employees.error ? <ErrorState title="Не удалось загрузить сотрудников." detail={employees.error} onRetry={employees.reload} /> :
        employees.loading ? <LoadingState text="Загружаем сотрудников…" /> :
        !employees.data?.length ? <EmptyState text="Пока нет сотрудников. Нажмите «Загрузить данные», чтобы добавить профиль." /> :
        profile.error ? <ErrorState title="Не удалось загрузить профиль." detail={profile.error} onRetry={profile.reload} /> :
        profile.loading || !profile.data ? <LoadingState text="Загружаем профиль…" /> :
        <EmployeeScreen key={employeeId} view={ai.view ?? profile.data} skillNames={skillNames} recommendationStatus={ai.status} completion={currentCompletion} onDismissCompletion={() => setCompletion(null)}
          completing={pending === employeeId} completionDisabled={pending !== null || !!currentFailure && currentFailure.error.phase !== "rejected"}
          failure={currentFailure?.error ?? null} onRefresh={() => void refreshAfterCompletion()}
          onComplete={(recommendation) => void complete(recommendation)} />}
    </main> : <main id="main-content" className="page hr-page" tabIndex={-1}>
      <div className="page-heading"><div><h1>Обзор команды</h1><p>Где нужна поддержка и как проходит обучение.</p></div></div>
      {hr.error ? <ErrorState title="Не удалось загрузить обзор команды." detail={hr.error} onRetry={hr.reload} /> :
        hr.loading || !hr.data ? <LoadingState text="Загружаем обзор команды…" /> :
        <HRDashboard summary={hr.data} onSelect={selectEmployee} />}
    </main>}
    {importOpen && <ImportDialog api={api} onClose={closeImport} onImported={imported} />}
  </div>;
}

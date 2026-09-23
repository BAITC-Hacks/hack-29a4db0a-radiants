"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp, LogOut, UsersRound } from "lucide-react";
import type { Recommendation } from "../types/career";
import type { EmployeeDetail, HrFilters } from "../contracts/api";
import type { AuthSession } from "../contracts/auth";
import { CompletionError, type CareerApi, type ImportResult } from "../lib/frontend/api";
import { useApiResource } from "../hooks/useApiResource";
import { useAiRecommendations } from "../hooks/useAiRecommendations";
import { EmployeeScreen, type CompletionSnapshot } from "./EmployeeScreen";
import { HRDashboard } from "./HRDashboard";
import { HRFilters as HRFilterControls } from "./HRFilters";
import { ImportDialog } from "./ImportDialog";
import { AccountsDialog } from "./AccountsDialog";
import { EmptyState, ErrorState, LoadingState } from "./States";

export default function App({ api, session, onSignOut }: { api: CareerApi; session: AuthSession; onSignOut: () => void }) {
  const isHr = session.user.role === "hr";
  const [employeeId, setEmployeeId] = useState(session.user.employeeId ?? "");
  const [screen, setScreen] = useState<"employee" | "hr">("employee");
  const [hrFilters, setHrFilters] = useState<HrFilters>({});
  const [importOpen, setImportOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountEmployeeId, setAccountEmployeeId] = useState<string>();
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
  const hrLoader = useCallback((signal: AbortSignal) => api.getHrSummary(signal, hrFilters), [api, hrFilters]);
  const employees = useApiResource("employees", listLoader);
  const catalog = useApiResource("catalog", catalogLoader);
  const skillNames = useMemo(() => Object.fromEntries(catalog.data?.skills.map((skill) => [skill.skill_id, skill.name]) ?? []), [catalog.data]);
  const profile = useApiResource(employeeId, viewLoader, !!employeeId && screen === "employee");
  const hr = useApiResource(`hr:${JSON.stringify(hrFilters)}`, hrLoader, isHr && screen === "hr");
  const ai = useAiRecommendations(api, profile.data, screen === "employee" && !importOpen && !accountsOpen &&
    !profile.loading && !profile.error && pending === null &&
    (failure?.before.employee.employee_id !== employeeId || failure?.error.phase === "rejected"));

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
      if (error instanceof CompletionError && error.status === 409) {
        try {
          const refreshed = await api.getEmployeeView(before.employee.employee_id);
          if (selected.current === before.employee.employee_id) profile.replace(refreshed);
          setImportNotice("Занятие уже завершено. Профиль обновлён.");
          return;
        } catch {
          setFailure({ before, error: new CompletionError("Занятие уже завершено, но профиль не удалось обновить. Повторите обновление.", "refresh") });
          return;
        }
      }
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
    profile.reload();
    hr.reload();
    setCompletion(null);
    setFailure(null);
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
    setImportNotice(result.message || "Данные загружены. Профили сотрудников обновлены.");
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
  function openAccounts(id?: string) {
    if (!isHr) return;
    ai.cancel();
    setImportOpen(false);
    setAccountEmployeeId(id);
    setAccountsOpen(true);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <header className="topbar">
      <div className="topbar-inner private-topbar">
        <a className="brand" href="#home" aria-label="Career Quest — развитие сотрудников" onClick={(event) => { event.preventDefault(); showScreen("employee"); }}>
          <span className="brand-caption">Career Quest<span>Развитие сотрудников</span></span>
        </a>
        <nav className="topbar-nav" aria-label="Разделы">
          <button className={`nav-link ${screen === "employee" ? "selected" : ""}`} aria-current={screen === "employee" ? "page" : undefined} onClick={() => showScreen("employee")}>{isHr ? "Профили" : "Мой план"}</button>
          {isHr && <button className={`nav-link ${screen === "hr" ? "selected" : ""}`} aria-current={screen === "hr" ? "page" : undefined} onClick={() => showScreen("hr")}>Обзор команды</button>}
        </nav>
        <div className="workspace-actions">
          {isHr && <button className="button button-outline" onClick={() => openAccounts()}><UsersRound size={17} />Доступ сотрудников</button>}
          {isHr && <button className="button button-outline top-import" disabled={pending !== null} onClick={() => { ai.cancel(); setImportNotice(""); setImportOpen(true); }}><FileUp size={17} />Загрузить данные</button>}
          <div className="session-controls"><span className="session-label">{session.user.username}<span>{isHr ? "HR" : "Сотрудник"}</span></span>
            <button className="button button-outline signout-button" onClick={() => { ai.cancel(); onSignOut(); }}><LogOut size={16} />Выйти</button></div>
        </div>
      </div>
    </header>
    {screen === "employee" ? <main id="main-content" className="page" tabIndex={-1}>
      <div className="page-heading">
        <div><h1>План развития</h1><p>Цель, навыки и следующий шаг.</p></div>
        {isHr && <label className="select-wrap" htmlFor="employee-select">
          <span className="select-label">Сотрудник</span>
          <select id="employee-select" value={employeeId} disabled={employees.loading || !employees.data?.length} onChange={(event) => selectEmployee(event.target.value)}>
            {!employeeId && <option value="">{employees.loading ? "Загружаем список…" : "Выберите сотрудника"}</option>}
            {employees.data?.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name || employee.employee_id} · {employee.role}</option>)}
          </select><ChevronDown size={16} />
        </label>}
      </div>
      <p className="section-note privacy-note">{isHr ? "Занятия отмечает завершёнными сам сотрудник в своём аккаунте." : "Профиль доступен вам и уполномоченным HR. Рекомендации — добровольные шаги развития."}</p>
      {importNotice && <div className="inline-success" role="status">{importNotice}</div>}
      {ai.status === "fallback" && <div className="ai-retry"><p className="section-note" role="status">Объяснения составлены по данным профиля. Уточнения ИИ сейчас недоступны.</p><button className="text-button" onClick={ai.retry}>Повторить запрос к ИИ</button></div>}
      {employees.error ? <ErrorState title="Не удалось загрузить сотрудников." detail={employees.error} onRetry={employees.reload} /> :
        employees.loading ? <LoadingState text="Загружаем профиль…" /> :
        !employees.data?.length ? <EmptyState text={isHr ? "Пока нет сотрудников. Загрузите профиль, чтобы начать." : "Ваш профиль недоступен. Обратитесь к HR."} /> :
        profile.error ? <ErrorState title="Не удалось загрузить профиль." detail={profile.error} onRetry={profile.reload} /> :
        profile.loading || !profile.data ? <LoadingState text="Загружаем план развития…" /> :
        <EmployeeScreen key={employeeId} view={ai.view ?? profile.data} skillNames={skillNames} events={catalog.data?.events} recommendationStatus={ai.status} allowCompletion={!isHr && session.user.employeeId === employeeId} completion={currentCompletion} onDismissCompletion={() => setCompletion(null)}
          completing={pending === employeeId} completionDisabled={pending !== null || !!currentFailure && currentFailure.error.phase !== "rejected"}
          failure={currentFailure?.error ?? null} onRefresh={() => void refreshAfterCompletion()}
          onComplete={(recommendation) => void complete(recommendation)} />}
    </main> : <main id="main-content" className="page hr-page" tabIndex={-1}>
      <div className="page-heading"><div><h1>Обзор команды</h1><p>Где нужна поддержка и как проходит обучение.</p></div></div>
      <HRFilterControls filters={hrFilters} employees={employees.data ?? []} roleProfiles={catalog.data?.roleProfiles ?? []} onChange={setHrFilters} />
      {hr.error ? <ErrorState title="Не удалось загрузить обзор команды." detail={hr.error} onRetry={hr.reload} /> :
        hr.loading || !hr.data ? <LoadingState text="Загружаем обзор команды…" /> :
        hr.data.metrics?.totalEmployees === 0 ? <EmptyState text="По выбранным фильтрам сотрудников нет. Измените условия или сбросьте фильтры." /> :
        <HRDashboard summary={hr.data} onSelect={selectEmployee} />}
    </main>}
    {isHr && importOpen && <ImportDialog api={api} onClose={closeImport} onImported={imported} onCreateAccess={openAccounts} />}
    {isHr && accountsOpen && <AccountsDialog api={api} employees={employees.data ?? []} initialEmployeeId={accountEmployeeId} onClose={() => setAccountsOpen(false)} />}
  </div>;
}

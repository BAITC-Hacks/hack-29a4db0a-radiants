import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { ApiError, type CareerApi, type EmployeeAccount, type EmployeeListItem } from "../lib/frontend/api";

type Fields = "employeeId" | "username" | "password" | "confirmed";
type FieldErrors = Partial<Record<Fields, string>>;
type Attempt = { username: string; employeeId: string; confirmed: boolean };

/** Presentation of the backend's reserved identity prefix; never an authorization check. */
const isDemoAccount = (account: EmployeeAccount) => account.id.startsWith("demo:");
export function accountStatusLabel(account: EmployeeAccount): string {
  return isDemoAccount(account)
    ? `Демодоступ · ${account.active ? "активная запись" : "неактивная запись"}`
    : account.active ? "Активен" : "Неактивен";
}

export function validateAccountFields(input: { employeeId: string; username: string; password: string; confirmed: boolean }, employees: EmployeeListItem[]): FieldErrors {
  const errors: FieldErrors = {};
  if (!employees.some((employee) => employee.employee_id === input.employeeId)) errors.employeeId = "Выберите существующий профиль сотрудника.";
  if (!/^[a-z0-9_.-]{3,80}$/i.test(input.username.trim())) errors.username = "От 3 до 80 символов: латинские буквы, цифры, точка, дефис или подчёркивание.";
  if (input.password.length < 12 || input.password.length > 128) errors.password = "Пароль должен содержать от 12 до 128 символов.";
  if (!input.confirmed) errors.confirmed = "Подтвердите, что выбран профиль нужного сотрудника.";
  return errors;
}

/** A successful read, not a repeated mutation, resolves an uncertain creation. */
export function accountCreationState(accounts: EmployeeAccount[], attempt: Pick<Attempt, "username" | "employeeId">): "found" | "conflict" | "missing" {
  const account = accounts.find((item) => item.username.toLowerCase() === attempt.username);
  if (!account) return "missing";
  return account.role === "employee" && account.employeeId === attempt.employeeId && !isDemoAccount(account) ? "found" : "conflict";
}

export function employeeAccessState(employeeId: string, accounts: EmployeeAccount[] | null, checking: boolean, error: string): "loading" | "unavailable" | "none" | "created" {
  if (checking) return "loading";
  if (error || accounts === null) return "unavailable";
  return accounts.some((account) => account.role === "employee" && account.employeeId === employeeId && !isDemoAccount(account)) ? "created" : "none";
}

export function EmployeeAccessStatus({ employeeId, accounts, checking, error }: {
  employeeId: string; accounts: EmployeeAccount[] | null; checking: boolean; error: string;
}) {
  const state = employeeAccessState(employeeId, accounts, checking, error);
  const linked = accounts?.filter((account) => account.role === "employee" && account.employeeId === employeeId) ?? [];
  const personal = linked.filter((account) => !isDemoAccount(account));
  const demo = linked.filter(isDemoAccount);
  return <div className="accounts-access-state" role="status" aria-live="polite">
    {state === "loading" && <p>Проверяем наличие аккаунта…</p>}
    {state === "unavailable" && <p>Статус аккаунта неизвестен. Обновите список доступов.</p>}
    {state === "none" && <strong>{demo.length ? "Нет личного аккаунта" : "Нет аккаунта"}</strong>}
    {state === "created" && <><strong>Аккаунт создан</strong><ul>{personal.map((account) =>
      <li key={account.id}>{account.username} · {account.active ? "Активен" : "Неактивен"}</li>)}</ul><p>Новый аккаунт для этого профиля не требуется. Если доступ утрачен или аккаунт неактивен, обратитесь к оператору.</p></>}
    {(state === "none" || state === "created") && demo.length > 0 && <><ul>{demo.map((account) => <li key={account.id}>{account.username} · {accountStatusLabel(account)}</li>)}</ul>
      <p>Демодоступ работает только при включённом деморежиме. Для личного входа с паролем нужен отдельный аккаунт.</p></>}
  </div>;
}

const messageOf = (issue: unknown) => issue instanceof ApiError ? issue.message : "Не удалось загрузить список доступов. Проверьте подключение.";

export function AccountsDialog({ api, employees, initialEmployeeId, onClose }: {
  api: CareerApi; employees: EmployeeListItem[]; initialEmployeeId?: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const [accounts, setAccounts] = useState<EmployeeAccount[] | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Attempt | null>(null);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const selected = employees.find((employee) => employee.employee_id === employeeId);
  const frozen = busy || checking || pending !== null;
  const accountExists = employeeAccessState(employeeId, accounts, checking, listError) === "created";

  useEffect(() => {
    const element = dialog.current;
    const controller = new AbortController();
    lifetime.current = controller;
    element?.showModal();
    api.getAccounts(controller.signal).then((items) => {
      if (!controller.signal.aborted) { setAccounts(items); setListError(""); }
    }).catch((issue: unknown) => {
      if (!controller.signal.aborted) setListError(messageOf(issue));
    }).finally(() => {
      if (!controller.signal.aborted) setChecking(false);
    });
    return () => { controller.abort(); element?.close(); };
  }, [api]);

  async function readAccounts(signal: AbortSignal, attempt: Attempt | null) {
    setChecking(true);
    setListError("");
    try {
      const items = await api.getAccounts(signal);
      if (signal.aborted) return;
      setAccounts(items);
      if (attempt) {
        const state = accountCreationState(items, attempt);
        if (state === "found") {
          const account = items.find((item) => item.username.toLowerCase() === attempt.username)!;
          setNotice(`${attempt.confirmed ? "Доступ создан" : "Доступ найден в списке"}: ${attempt.username}. ${account.active ? "Повторять создание не нужно." : "Аккаунт неактивен; обратитесь к оператору."}`);
          setError(""); setPending(null); setUsername(""); setConfirmed(false);
        } else if (state === "conflict") {
          setPending(null); setNotice("");
          setError("Это имя пользователя связано с другим аккаунтом. Выберите другое имя.");
          setFieldErrors({ username: "Имя уже занято другим аккаунтом." });
        } else if (attempt.confirmed) {
          setError("Сервер подтвердил создание, но запись пока не появилась в списке. Обновите список; повторное создание недоступно.");
          setNotice("");
        } else {
          setPending(null); setNotice("");
          setError("Создание не подтверждено: такого доступа в списке нет. Для повторной попытки введите пароль заново и нажмите «Создать доступ».");
        }
      }
    } catch (issue) {
      if (!signal.aborted) {
        setListError(messageOf(issue));
        if (attempt) setNotice(attempt.confirmed
          ? "Сервер подтвердил создание. Список пока не обновлён."
          : "Результат создания неизвестен. Нажмите «Обновить список»." );
      }
    } finally {
      if (!signal.aborted) setChecking(false);
    }
  }

  async function refresh() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || lock.current) return;
    lock.current = true;
    try { await readAccounts(signal, pending); }
    finally { lock.current = false; }
  }

  async function createAccount() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || lock.current || frozen || !accounts || listError || accountExists) return;
    const normalized = username.trim().toLowerCase();
    const validation = validateAccountFields({ employeeId, username: normalized, password, confirmed }, employees);
    if (accounts.some((account) => account.username.toLowerCase() === normalized)) validation.username = "Это имя пользователя уже занято. Выберите другое.";
    setFieldErrors(validation); setError(""); setNotice("");
    if (Object.keys(validation).length) return;
    lock.current = true;
    setBusy(true);
    setUsername(normalized);
    const attempt: Attempt = { username: normalized, employeeId, confirmed: false };
    try {
      await api.createEmployeeAccount({ username: normalized, password, employeeId }, signal);
      if (signal.aborted) return;
      setPassword("");
      const accepted = { ...attempt, confirmed: true };
      setPending(accepted);
      setNotice("Доступ создан. Обновляем список…");
      await readAccounts(signal, accepted);
    } catch (issue) {
      if (signal.aborted) return;
      setPassword("");
      const rejected = issue instanceof ApiError && issue.status !== undefined && issue.status >= 400 && issue.status < 500 && issue.status !== 408;
      if (rejected) {
        setError(issue.message);
        const details: FieldErrors = {};
        for (const detail of issue.details) {
          if (detail.field === "username") details.username = "Проверьте имя: 3–80 латинских букв, цифр или символов _ . -";
          if (detail.field === "password") details.password = "Пароль должен содержать от 12 до 128 символов.";
          if (detail.field === "employeeId") details.employeeId = "Выберите существующий профиль сотрудника.";
        }
        if (issue.code === "USERNAME_EXISTS") details.username = "Имя занято. Выберите другое.";
        if (issue.code === "EMPLOYEE_NOT_FOUND") details.employeeId = "Сначала импортируйте профиль сотрудника, затем обновите страницу.";
        setFieldErrors(details);
      } else {
        setPending(attempt);
        setNotice("Результат создания пока неизвестен. Проверяем список доступов…");
        await readAccounts(signal, attempt);
      }
    } finally {
      lock.current = false;
      if (!signal.aborted) { setPassword(""); setBusy(false); }
    }
  }

  return <dialog ref={dialog} className="dialog accounts-dialog" aria-labelledby="accounts-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head"><div><h2 id="accounts-title">Доступ сотрудников</h2><p className="dialog-copy">Личные аккаунты для существующих профилей.</p></div>
      <button className="icon-button" autoFocus disabled={busy} aria-label="Закрыть доступ сотрудников" onClick={onClose}><X size={18} /></button>
    </div>
    <div className="accounts-layout">
      <section className="accounts-list" aria-labelledby="accounts-list-title">
        <div className="accounts-section-heading"><h3 id="accounts-list-title">Созданные аккаунты</h3>
          <button type="button" className="button button-outline" disabled={busy || checking} onClick={() => void refresh()}>Обновить список</button></div>
        {checking && <p className="accounts-status" role="status"><LoaderCircle className="spin" size={17} />Загружаем список…</p>}
        {listError && <div className="import-error" role="alert">{listError}{pending && <p>Сначала обновите список. Повторная отправка формы пока недоступна.</p>}</div>}
        {accounts && <div className="accounts-table"><table><thead><tr><th>Имя пользователя</th><th>Сотрудник</th><th>ID профиля</th><th>Статус</th></tr></thead>
          <tbody>{accounts.map((account) => <tr key={account.id}>
            <td>{account.username}</td><td>{account.employeeId === null ? "HR-аккаунт" : employees.find((employee) => employee.employee_id === account.employeeId)?.full_name ?? "Профиль недоступен"}</td>
            <td>{account.employeeId ?? "—"}</td><td>{accountStatusLabel(account)}</td>
          </tr>)}</tbody></table>{accounts.length === 0 && <p className="empty-state">Аккаунтов пока нет.</p>}
          {accounts.some(isDemoAccount) && <p className="field-hint">Записи демодоступа остаются в списке после отключения деморежима. Они не заменяют личные аккаунты с паролем.</p>}
        </div>}
      </section>
      <form className="accounts-form" noValidate onSubmit={(event) => { event.preventDefault(); void createAccount(); }}>
        <h3>Создать личный доступ</h3>
        <div className="accounts-field"><label htmlFor="account-employee">Сотрудник</label>
          <select id="account-employee" value={employeeId} disabled={frozen} required aria-invalid={!!fieldErrors.employeeId} aria-describedby={fieldErrors.employeeId ? "account-employee-error" : undefined}
            onChange={(event) => { setEmployeeId(event.target.value); setConfirmed(false); setFieldErrors({}); setUsername(""); setPassword(""); setError(""); setNotice(""); }}>
            <option value="">Выберите сотрудника</option>{employees.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name} · {employee.employee_id}</option>)}
          </select>{fieldErrors.employeeId && <p id="account-employee-error" className="field-error">{fieldErrors.employeeId}</p>}
        </div>
        {selected && <div className="accounts-binding"><strong>{selected.full_name}</strong><span>{selected.role} · {selected.employee_id}</span><p>Доступ сотрудника: только собственный профиль.</p>
          <EmployeeAccessStatus employeeId={selected.employee_id} accounts={accounts} checking={checking} error={listError} />
        </div>}
        <div className="accounts-field"><label htmlFor="account-username">Имя пользователя</label>
          <input id="account-username" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} value={username} required minLength={3} maxLength={80} disabled={frozen || accountExists}
            aria-invalid={!!fieldErrors.username} aria-describedby={fieldErrors.username ? "account-username-error" : "account-username-hint"}
            onChange={(event) => { setUsername(event.target.value.toLowerCase()); setFieldErrors((current) => ({ ...current, username: undefined })); }} />
          <p id="account-username-hint" className="field-hint">3–80 символов: латинские буквы, цифры, точка, дефис или подчёркивание.</p>
          {fieldErrors.username && <p id="account-username-error" className="field-error">{fieldErrors.username}</p>}
        </div>
        <div className="accounts-field"><label htmlFor="account-password">Новый пароль</label>
          <input id="account-password" name="password" type="password" autoComplete="new-password" value={password} required minLength={12} disabled={frozen || accountExists}
            aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? "account-password-error" : "account-password-hint"}
            onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); }} />
          <p id="account-password-hint" className="field-hint">12–128 символов. Пробелы сохраняются. После ответа сервера поле очищается.</p>
          {fieldErrors.password && <p id="account-password-error" className="field-error">{fieldErrors.password}</p>}
        </div>
        <label className="accounts-confirm"><input type="checkbox" checked={confirmed} disabled={frozen || !selected || accountExists} aria-invalid={!!fieldErrors.confirmed} aria-describedby={fieldErrors.confirmed ? "account-confirm-error" : undefined}
          onChange={(event) => { setConfirmed(event.target.checked); setFieldErrors((current) => ({ ...current, confirmed: undefined })); }} /><span>Подтверждаю: доступ привязан к нужному сотруднику{selected ? ` — ${selected.full_name}` : ""}.</span></label>
        {fieldErrors.confirmed && <p id="account-confirm-error" className="field-error">{fieldErrors.confirmed}</p>}
        <p className="accounts-note">Сохраните пароль перед созданием и передайте его сотруднику лично по приватному каналу. Здесь пароль больше не показывается. Автоматической отправки нет.</p>
        {error && <div className="import-error" role="alert">{error}</div>}
        {notice && <p className="accounts-status" role="status">{pending ? <LoaderCircle className={checking ? "spin" : undefined} size={17} /> : <Check size={17} />}{notice}</p>}
        <button type="submit" className="button button-green" disabled={frozen || !accounts || !!listError || employees.length === 0 || accountExists}>{busy ? "Создаём доступ…" : accountExists ? "Аккаунт уже создан" : "Создать доступ"}</button>
        {employees.length === 0 && <p className="field-hint">Сначала импортируйте профиль сотрудника.</p>}
      </form>
    </div>
    <div className="dialog-foot"><button type="button" className="button button-outline" disabled={busy} onClick={onClose}>Закрыть</button></div>
  </dialog>;
}

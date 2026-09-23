import { useEffect, useRef, useState } from "react";
import { Check, FileText, LoaderCircle, Upload, X } from "lucide-react";
import { ApiError, type CareerApi, type ImportResult } from "../lib/frontend/api";
import type { ApiErrorDetail } from "../contracts/api";

export function ImportDialog({ api, onClose, onImported, onCreateAccess }: {
  api: CareerApi; onClose: () => void; onImported: (result: ImportResult) => Promise<void>;
  onCreateAccess?: (employeeId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<ApiErrorDetail[]>([]);
  const [accessId, setAccessId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    mounted.current = true;
    element?.showModal();
    return () => { mounted.current = false; element?.close(); };
  }, []);
  function choose(candidate?: File) {
    if (!candidate || busy || result) return;
    setError("");
    setIssues([]);
    if (!/\.(json|csv)$/i.test(candidate.name)) { setFile(null); setError("Выберите файл JSON или CSV."); return; }
    setFile(candidate);
  }
  function importAnother() {
    setFile(null);
    setError("");
    setIssues([]);
    setAccessId("");
    setResult(null);
    setDone(false);
  }
  async function upload() {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setIssues([]);
    let uploaded = result;
    try {
      if (!uploaded) {
        uploaded = await api.importData(file);
        if (!mounted.current) return;
        setResult(uploaded);
      }
      await onImported(uploaded);
      if (!mounted.current) return;
      setAccessId(uploaded.employeeIds?.[0] ?? "");
      setDone(true);
    } catch (issue) {
      if (!mounted.current) return;
      const detail = issue instanceof Error ? issue.message : "Не удалось загрузить файл.";
      setError(uploaded ? `Данные загружены, но профили не удалось обновить. ${detail}` : detail);
      setIssues(issue instanceof ApiError ? issue.details : []);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <dialog ref={dialog} className="dialog import-dialog" aria-labelledby="import-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head"><h2 id="import-title">Загрузить данные</h2>
      <button className="icon-button" autoFocus disabled={busy} aria-label="Закрыть окно загрузки" onClick={onClose}><X size={18} /></button>
    </div>
    {!done && <>
    <p className="dialog-copy">Для нового сотрудника сначала загрузите профиль в JSON, затем историю активностей в CSV.</p>
    <div className={`dropzone import-file-picker${file ? " has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>
      {file ? <><FileText size={24} aria-hidden="true" /><div className="import-file-description"><strong>{file.name}</strong><span>{file.name.split(".").pop()?.toUpperCase()} · {formatFileSize(file.size)}</span></div></> :
        <><Upload size={24} aria-hidden="true" /><div className="import-file-description"><strong>Выберите или перетащите файл</strong><span>Поддерживаются JSON и CSV</span></div></>}
      <button className="button button-outline" disabled={busy || !!result} onClick={() => input.current?.click()}>Выбрать файл</button>
      <input ref={input} type="file" aria-label="Файл для загрузки" accept=".json,.csv,application/json,text/csv"
        onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
    </>}
    {busy && <p className="import-progress" role="status"><LoaderCircle className="spin" size={17} />{result ? "Обновляем профили…" : "Загружаем и обрабатываем файл…"}</p>}
    {error && <div className="import-error" role="alert">{error}</div>}
    {issues.length > 0 && <ul className="validation-details">{issues.map((issue, index) => <li key={index}>
      <strong>{[issue.file, issue.row !== undefined ? `Строка ${issue.row}` : undefined, issue.field].filter(Boolean).join(" · ")}</strong>
      <span>{issue.message}</span>
    </li>)}</ul>}
    {result?.warnings?.length ? <div className="import-warnings"><strong>Примечания</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
    {done && <div className="inline-success import-success" role="status"><Check size={20} aria-hidden="true" /><div><strong>Данные загружены</strong><p>{result?.message || "Профили сотрудников обновлены."}</p>{file && <span className="import-file-name">{file.name}</span>}</div></div>}
    {done && /\.json$/i.test(file?.name ?? "") && <p className="dialog-copy">Теперь можно загрузить историю активностей этого сотрудника в CSV.</p>}
    {done && /\.json$/i.test(file?.name ?? "") && onCreateAccess && accessId && <div className="import-access">
      <h3>Доступ к личному профилю</h3><p className="section-note">Создайте сотруднику отдельный аккаунт. Историю обучения можно загрузить до или после этого.</p>
      {result?.employeeIds && result.employeeIds.length > 1 && <label>Профиль для доступа
        <select value={accessId} onChange={(event) => setAccessId(event.target.value)}>{result.employeeIds.map((id) => <option key={id} value={id}>{id}</option>)}</select>
      </label>}
      <button className="text-button" onClick={() => onCreateAccess(accessId)}>Создать доступ</button>
    </div>}
    <div className="dialog-foot">
      {!done && <button className="button button-outline" disabled={busy} onClick={onClose}>Отмена</button>}
      {done && <button className="button button-outline" onClick={importAnother}>Загрузить ещё файл</button>}
      {done ? <button className="button button-green" onClick={onClose}>Открыть профиль</button> :
        <button className="button button-green" disabled={busy || !file} onClick={() => void upload()}>{busy ? "Подождите…" : result ? "Обновить профили" : "Загрузить"}</button>}
    </div>
  </dialog>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`;
  return `${(bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

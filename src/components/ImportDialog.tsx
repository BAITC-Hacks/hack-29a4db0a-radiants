import { useEffect, useRef, useState } from "react";
import { Check, FileText, LoaderCircle, Upload, X } from "lucide-react";
import type { CareerApi, ImportResult } from "../lib/frontend/api";

export function ImportDialog({ api, onClose, onImported }: {
  api: CareerApi; onClose: () => void; onImported: (result: ImportResult) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function choose(candidate?: File) {
    if (!candidate || busy || result) return;
    setError("");
    if (!/\.(json|csv)$/i.test(candidate.name)) { setFile(null); setError("Выберите файл JSON или CSV."); return; }
    setFile(candidate);
  }
  function importAnother() {
    setFile(null);
    setError("");
    setResult(null);
    setDone(false);
  }
  async function upload() {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let uploaded = result;
    try {
      if (!uploaded) {
        uploaded = await api.importData(file);
        setResult(uploaded);
      }
      await onImported(uploaded);
      setDone(true);
    } catch (issue) {
      const detail = issue instanceof Error ? issue.message : "Не удалось загрузить файл.";
      setError(uploaded ? `Данные загружены, но профили не удалось обновить. ${detail}` : detail);
    } finally {
      lock.current = false;
      setBusy(false);
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
    {result?.warnings?.length ? <div className="import-warnings"><strong>Примечания</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
    {done && <div className="inline-success import-success" role="status"><Check size={20} aria-hidden="true" /><div><strong>Данные загружены</strong><p>{result?.message || "Профили сотрудников обновлены."}</p>{file && <span className="import-file-name">{file.name}</span>}</div></div>}
    {done && /\.json$/i.test(file?.name ?? "") && <p className="dialog-copy">Теперь можно загрузить историю активностей этого сотрудника в CSV.</p>}
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

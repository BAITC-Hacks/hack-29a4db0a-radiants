import { useEffect, useRef, useState } from "react";
import { CloudUpload, LoaderCircle, X } from "lucide-react";
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
    if (!/\.(json|csv)$/i.test(candidate.name)) { setFile(null); setError("Choose a JSON or CSV file."); return; }
    setFile(candidate);
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
      const detail = issue instanceof Error ? issue.message : "Could not import this file.";
      setError(uploaded ? `Import succeeded, but employee profiles could not be refreshed. ${detail}` : detail);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <dialog ref={dialog} className="dialog import-dialog" aria-labelledby="import-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head"><h2 id="import-title">Import profile or activity history</h2>
      <button className="icon-button" autoFocus disabled={busy} aria-label="Close import dialog" onClick={onClose}><X size={18} /></button>
    </div>
    <p className="dialog-copy">Choose a JSON or CSV file. Your profile will refresh after the upload has been processed.</p>
    {!done && <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>
      <CloudUpload size={27} /><strong>{file ? file.name : "Drop a file here, or browse"}</strong><span>JSON / CSV</span>
      <button className="button button-outline" disabled={busy || !!result} onClick={() => input.current?.click()}>Choose file</button>
      <input ref={input} type="file" aria-label="Import file" accept=".json,.csv,application/json,text/csv"
        onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    </div>}
    {busy && <p className="import-progress" role="status"><LoaderCircle className="spin" size={17} />{result ? "Refreshing employee profiles…" : "Uploading and processing file…"}</p>}
    {error && <div className="import-error" role="alert">{error}</div>}
    {result?.warnings?.length ? <div className="import-warnings"><strong>Import notes</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
    {done && <div className="inline-success" role="status">{result?.message || "Import completed. Employee profiles refreshed."}</div>}
    <div className="dialog-foot">
      <button className="button button-outline" disabled={busy} onClick={onClose}>{done ? "Close" : "Cancel"}</button>
      {done ? <button className="button button-green" onClick={onClose}>View profile</button> :
        <button className="button button-green" disabled={busy || !file} onClick={() => void upload()}>{busy ? "Please wait…" : result ? "Retry refresh" : "Upload file"}</button>}
    </div>
  </dialog>;
}

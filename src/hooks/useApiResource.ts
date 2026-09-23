import { useCallback, useEffect, useRef, useState } from "react";

/** Each result belongs to its request key; late responses cannot replace another profile. */
export function useApiResource<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data?: T; error?: string; loading: boolean; version: number }>({ key: "", loading: true, version: 0 });
  const version = useRef(0);
  const activeKey = useRef(key);
  activeKey.current = key;
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    controller.current?.abort();
    setSnapshot((old) => ({ ...old, loading: true, error: undefined }));
    setRevision((value) => value + 1);
  }, []);
  const replace = useCallback((data: T) => {
    if (activeKey.current !== key) return;
    controller.current?.abort();
    setSnapshot({ key, data, loading: false, version: ++version.current });
  }, [key]);
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    controller.current = request;
    setSnapshot((old) => ({ key, data: old.key === key ? old.data : undefined, loading: true, version: old.version }));
    void loader(request.signal).then(
      (data) => { if (!request.signal.aborted && activeKey.current === key) setSnapshot({ key, data, loading: false, version: ++version.current }); },
      (error: unknown) => {
        if (!request.signal.aborted && activeKey.current === key) setSnapshot((old) => ({ ...old, key, loading: false,
          error: error instanceof Error ? error.message : "Could not load data." }));
      },
    );
    return () => request.abort();
  }, [key, loader, enabled, revision]);
  const current = snapshot.key === key ? snapshot : { key, loading: true, version: 0 };
  return { ...current, reload, replace };
}

import { useCallback, useEffect, useRef, useState } from "react";

/** Each result belongs to its request key; late responses cannot replace another profile. */
export function useApiResource<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data?: T; error?: string; loading: boolean }>({ key: "", loading: true });
  const activeKey = useRef(key);
  activeKey.current = key;
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const replace = useCallback((data: T) => {
    if (activeKey.current !== key) return;
    controller.current?.abort();
    setSnapshot({ key, data, loading: false });
  }, [key]);
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    controller.current = request;
    setSnapshot({ key, loading: true });
    void loader(request.signal).then(
      (data) => { if (!request.signal.aborted) setSnapshot({ key, data, loading: false }); },
      (error: unknown) => {
        if (!request.signal.aborted) setSnapshot({ key, loading: false,
          error: error instanceof Error ? error.message : "Could not load data." });
      },
    );
    return () => request.abort();
  }, [key, loader, enabled, revision]);
  const current = snapshot.key === key ? snapshot : { key, loading: true };
  return { ...current, reload, replace };
}

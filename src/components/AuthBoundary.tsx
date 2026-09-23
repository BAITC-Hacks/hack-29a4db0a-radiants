"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { AuthSession, DemoLoginSelection } from "../contracts/auth";
import { AuthLifecycle, bindAuthPageEvents, createAuthApi } from "../lib/frontend/auth-api";
import { ApiError, createCareerApi } from "../lib/frontend/api";
import App from "./App";
import { ErrorState, LoadingState } from "./States";

const auth = createAuthApi();

function DemoAccessNotice() {
  return <p role="note" className="import-warnings" style={{ margin: 0, padding: "12px 24px", borderRadius: 0 }}>
    <strong>Демо-режим: общий доступ к профилям сотрудников. Личные данные в этом режиме не защищены индивидуальным паролем.</strong>
  </p>;
}

/** Protected data is visible only after the server confirms the current session. */
export default function AuthBoundary({ demoLoginEnabled = false }: { demoLoginEnabled?: boolean }) {
  const [lifecycle] = useState(() => new AuthLifecycle(auth));
  const state = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);
  const { session, generation, signal } = state;
  const api = useMemo(() => createCareerApi({ csrfToken: session?.csrfToken, sessionSignal: signal,
    onUnauthorized: () => lifecycle.unauthorized(generation),
  }), [generation, lifecycle, session, signal]);

  useEffect(() => {
    // Hide synchronously on pagehide so a restored browser page starts with a covered private view.
    const unbind = bindAuthPageEvents(lifecycle, window, document, flushSync);
    let channel: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("career-quest-auth");
        channel.onmessage = (event: MessageEvent<unknown>) => flushSync(() => {
          lifecycle.receive(event.data);
          if (document.visibilityState === "hidden") lifecycle.suspend();
        });
        lifecycle.broadcast = (message) => channel?.postMessage(message);
      }
    } catch { /* Focus and visibility checks remain available when cross-tab messaging is unsupported. */ }
    if (document.visibilityState === "hidden") lifecycle.suspend();
    else void lifecycle.check();
    return () => {
      unbind();
      if (channel) { channel.onmessage = null; channel.close(); }
      lifecycle.dispose();
    };
  }, [lifecycle]);

  useEffect(() => {
    if (!session) return;
    const expiresIn = Date.parse(session.expiresAt) - Date.now();
    const timer = setTimeout(() => lifecycle.expire(generation), Math.max(0, Math.min(expiresIn, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [generation, lifecycle, session]);

  // Keep same-session dialog state (including a native file chooser/import receipt) while revalidating.
  // The whole subtree is hidden and inert until the server confirms that exact identity and token.
  const protectedApp = session && ["ready", "checking", "hidden"].includes(state.phase)
    ? <div className="protected-app" hidden={state.phase !== "ready"} inert={state.phase !== "ready"}>
      {demoLoginEnabled && <DemoAccessNotice />}
      <App key={generation} api={api} session={session} demoLoginEnabled={demoLoginEnabled} onSignOut={() => void lifecycle.logout()} />
    </div> : null;
  let authScreen: ReactNode = null;
  if (state.phase === "checking" || state.phase === "hidden") authScreen = <AuthStatus><LoadingState text="Проверяем вход…" /></AuthStatus>;
  else if (state.phase === "checkFailed") authScreen = <AuthStatus><ErrorState title="Не удалось проверить вход" detail="Данные профиля скрыты. Проверьте подключение и попробуйте ещё раз." onRetry={() => void lifecycle.check()} /></AuthStatus>;
  else if (state.phase === "signingOut") authScreen = <AuthStatus><LoadingState text="Выходим из аккаунта…" /></AuthStatus>;
  else if (state.phase === "logoutFailed") authScreen = <AuthStatus><ErrorState title="Не удалось подтвердить выход" detail="Профиль скрыт. Повторите выход, когда подключение восстановится." onRetry={() => void lifecycle.logout()} /></AuthStatus>;
  else if (!session || state.phase !== "ready") authScreen = <LoginForm notice={state.notice} demoLoginEnabled={demoLoginEnabled} onSignedIn={(value) => lifecycle.accept(value)} />;
  return <>{protectedApp}{authScreen}</>;
}

function AuthStatus({ children }: { children: ReactNode }) {
  return <main className="auth-shell"><section className="auth-status-card"><p className="brand">Career Quest</p>{children}</section></main>;
}

export function LoginForm({ notice = "", demoLoginEnabled = false, onSignedIn }: { notice?: string; demoLoginEnabled?: boolean; onSignedIn: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<DemoLoginSelection | null>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { usernameInput.current?.focus(); return () => request.current?.abort(); }, []);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);
  useEffect(() => { if (selection) selectionHeading.current?.focus(); else usernameInput.current?.focus(); }, [selection]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signIn(password);
  }
  async function signIn(submittedPassword: string, employeeId?: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError("");
    try {
      const result = await auth.login(username.trim(), submittedPassword, controller.signal, employeeId);
      if (!controller.signal.aborted) {
        setPassword("");
        if ("kind" in result) {
          if (!demoLoginEnabled) throw new ApiError("Не удалось подтвердить вход. Попробуйте ещё раз.");
          setSelection(result);
        } else onSignedIn(result);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : "Не удалось войти. Проверьте подключение и попробуйте ещё раз.");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) { setPassword(""); setPending(false); }
    }
  }
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="login-heading">
    <p className="brand">Career Quest</p><h1 id="login-heading">Вход в аккаунт</h1>
    {demoLoginEnabled ? <><DemoAccessNotice /><p className="section-note" id="login-privacy">Введите имя и фамилию из данных. Пароль для демо: <strong>admin</strong>.</p></>
      : <p className="section-note" id="login-privacy">Ваш профиль и история обучения доступны вам и HR с правами доступа.</p>}
    {notice && <p role="status" className="inline-success">{notice}</p>}
    {selection ? <section className="login-choices" aria-busy={pending} aria-labelledby="login-choice-heading">
      <h2 id="login-choice-heading" ref={selectionHeading} tabIndex={-1}>Выберите свой профиль</h2>
      <p className="section-note">Несколько сотрудников указаны как {selection.choices[0]!.fullName}. Уточните подразделение и должность.</p>
      <div className="login-choice-list">{selection.choices.map((choice, index) => <button key={choice.employeeId} className="login-choice" disabled={pending}
        onClick={() => void signIn("admin", choice.employeeId)} aria-label={`${choice.department}, ${choice.role}, ${choice.grade}, профиль ${index + 1}`}>
        <strong>{choice.department || "Подразделение не указано"}</strong><span>{choice.role} · {choice.grade}</span>
      </button>)}</div>
      {pending && <p role="status" className="section-note">Входим…</p>}
      <button className="text-button" disabled={pending} onClick={() => { setSelection(null); setError(""); }}>Изменить имя</button>
    </section> : <form onSubmit={(event) => void submit(event)} aria-busy={pending} aria-describedby="login-privacy">
      <label htmlFor="login-username">{demoLoginEnabled ? "Имя и фамилия" : "Логин"}</label>
      <input ref={usernameInput} id="login-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={demoLoginEnabled ? "Например, Ksenia Pavlova" : undefined} required minLength={demoLoginEnabled ? 1 : 3} maxLength={demoLoginEnabled ? 200 : 80} pattern={demoLoginEnabled ? undefined : "[a-zA-Z0-9_.\\-]+"} value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} />
      <label htmlFor="login-password">Пароль</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} />
      <button className="button button-green" disabled={pending}>{pending ? "Входим…" : "Войти"}</button>
    </form>}
    {error && <p ref={errorMessage} role="alert" tabIndex={-1} className="import-error">{error}</p>}
    <p className="section-note auth-caption">{demoLoginEnabled
      ? "Для HR: введите hr-admin в поле имени и свой отдельный пароль."
      : "Чтобы получить доступ, обратитесь к HR."}</p>
  </section></main>;
}

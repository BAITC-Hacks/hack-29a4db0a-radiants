"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AuthSession } from "../contracts/auth";
import { createAuthApi } from "../lib/frontend/auth-api";
import { ApiError, createCareerApi } from "../lib/frontend/api";
import App from "./App";
import { ErrorState, LoadingState } from "./States";

const auth = createAuthApi();

function DemoAccessNotice() {
  return <p role="note" className="import-warnings" style={{ margin: 0, padding: "12px 24px", borderRadius: 0 }}>
    <strong>Demo mode — shared employee access, not private authentication.</strong>
  </p>;
}

/** Protected data exists only inside one authenticated session's mounted App. */
export default function AuthBoundary({ demoLoginEnabled = false }: { demoLoginEnabled?: boolean }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [initialError, setInitialError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const currentSession = useRef(session);
  currentSession.current = session;
  const sessionRequests = useMemo(() => ({ session, controller: new AbortController() }), [session]);
  const { controller } = sessionRequests;
  const invalidate = useCallback(() => {
    controller.abort();
    setSession(null);
    setSigningOut(false);
    setSignOutError("");
    setNotice("Your session ended. Sign in to continue.");
  }, [controller]);
  const api = useMemo(() => createCareerApi({ csrfToken: session?.csrfToken, sessionSignal: controller.signal,
    onUnauthorized: () => { if (currentSession.current === session) invalidate(); },
  }), [controller, invalidate, session]);

  useEffect(() => {
    const request = new AbortController();
    setChecking(true);
    setInitialError("");
    void auth.getSession(request.signal).then((value) => {
      if (!request.signal.aborted) setSession(value);
    }, (error: unknown) => {
      if (!request.signal.aborted && !(error instanceof ApiError && error.status === 401)) {
        setInitialError("Could not check your session. Please retry.");
      }
    }).finally(() => { if (!request.signal.aborted) setChecking(false); });
    return () => request.abort();
  }, [revision]);

  useEffect(() => {
    if (!session) return;
    const expiresIn = Date.parse(session.expiresAt) - Date.now();
    if (expiresIn <= 0) { invalidate(); return; }
    const timer = setTimeout(invalidate, Math.min(expiresIn, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [invalidate, session]);

  async function logout() {
    if (!session) return;
    controller.abort();
    setSigningOut(true);
    setSignOutError("");
    try {
      await auth.logout(session.csrfToken);
      if (currentSession.current !== session) return;
      setSession(null);
      setNotice("You have signed out.");
      setSigningOut(false);
    } catch (error) {
      if (currentSession.current !== session) return;
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        setSigningOut(false);
      } else setSignOutError("Could not confirm sign-out. Your profile is hidden. Retry to end the server session.");
    }
  }

  if (checking) return <main className="auth-shell"><LoadingState text="Checking your session…" /></main>;
  if (initialError) return <main className="auth-shell"><ErrorState title={initialError} detail="Protected profiles remain hidden until the server confirms your session." onRetry={() => setRevision((value) => value + 1)} /></main>;
  if (signingOut) return <main className="auth-shell">{signOutError
    ? <ErrorState title={signOutError} detail="Keep this page open and retry when the connection returns." onRetry={() => void logout()} /> : <LoadingState text="Signing out…" />}</main>;
  if (!session) return <LoginForm notice={notice} demoLoginEnabled={demoLoginEnabled} onSignedIn={(value) => { setNotice(""); setSession(value); }} />;
  return <>{demoLoginEnabled && <DemoAccessNotice />}<App key={`${session.user.id}:${session.expiresAt}`} api={api} session={session} demoLoginEnabled={demoLoginEnabled} onSignOut={() => void logout()} /></>;
}

export function LoginForm({ notice = "", demoLoginEnabled = false, onSignedIn }: { notice?: string; demoLoginEnabled?: boolean; onSignedIn: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError("");
    try {
      const session = await auth.login(username.trim(), password, controller.signal);
      if (!controller.signal.aborted) { setPassword(""); onSignedIn(session); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : "Could not sign in. Please check your connection.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) { setPassword(""); setPending(false); }
    }
  }
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="login-heading">
    <p className="brand">Career Quest</p><h1 id="login-heading">Sign in</h1>
    {demoLoginEnabled ? <><DemoAccessNotice /><p className="section-note">Employee login: enter the full name as it appears in the dataset and use password <strong>admin</strong>. For matching names, add the employee ID: Ksenia Pavlova (E0058). HR uses <strong>hr-admin</strong> and its individual password.</p></>
      : <p className="section-note">Use your individual account. Your profile and activity history are private to you and authorized HR staff.</p>}
    {notice && <p role="status" className="inline-success">{notice}</p>}
    <form onSubmit={(event) => void submit(event)} aria-busy={pending}>
      <label htmlFor="login-username">{demoLoginEnabled ? "Full name or username" : "Username"}</label>
      <input id="login-username" name="username" autoComplete="username" required minLength={demoLoginEnabled ? 1 : 3} maxLength={demoLoginEnabled ? 200 : 80} pattern={demoLoginEnabled ? undefined : "[a-zA-Z0-9_.\\-]+"} value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending} />
      <label htmlFor="login-password">Password</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} />
      {error && <p role="alert" className="import-error">{error}</p>}
      <button className="button button-green" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
    <p className="section-note">{demoLoginEnabled
      ? "Demo access also works for imported employee profiles. Individual account passwords and the HR password stay unchanged."
      : "Need access? Ask the application operator. Setup instructions are in the README; credentials are never shared on this page."}</p>
  </section></main>;
}

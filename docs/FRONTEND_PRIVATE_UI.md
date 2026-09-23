# Private frontend delivery — 2026-09-23

Based on team `main` at `1e0bab4`; branch `feat/private-frontend`. This implements the frontend handoff without replacing the authenticated App with the earlier public frontend. Backend routes, canonical contracts, database migrations, dependencies and Docker configuration are unchanged.

## Delivered

- Russian login, employee, HR, import and account-access screens. Career Quest text branding only; no bank logo. The previous green/white design and self-hosted Cyrillic Manrope font are retained. Font source: https://github.com/google/fonts/tree/main/ofl/manrope; OFL license in `public/fonts/OFL-Manrope.txt`.
- HR-only **Доступ сотрудников** lists username, bound profile ID/name and active status. It creates employee accounts through the existing shared API transport with session cancellation and CSRF.
- A selected employee explicitly shows **Нет аккаунта** or **Аккаунт создан**, plus loading/error states. Existing bindings disable duplicate creation while allowing selection of another employee.
- Creation requires an existing profile, username validation, a 12–128-character password and explicit binding confirmation. Passwords are never trimmed and are cleared after the response. The list contains no passwords. Instructions ask HR to transfer credentials privately; no email sending or unsupported account-management buttons.
- Successful JSON import offers **Создать доступ**, preselecting an ID returned by the backend. Batch imports expose a profile selector. JSON/CSV uploads remain original files; validation stays on the server, with file/row/field details displayed in the dialog.
- An uncertain account creation is reconciled by reading the account list. There is no automatic repeat POST. Failed reconciliation keeps creation locked until a successful read. An accepted import retains its receipt and retries only profile refresh; profile and HR data are invalidated before that refresh can fail.
- Completion HTTP 409 refreshes the profile by GET. Uncertain completion requires a read before another attempt. HR never gets completion actions; employee controls remain limited to the session-bound profile.
- Confirmed current skills and target gaps, all effective skills without a goal, mandatory due dates, complete activity history and assignment sources remain visible. `projectedLevel` is not presented as a forecast. Backend `expectedChanges` appear separately as an estimate before completion, with before → after values and target/critical requirements; no readiness forecast is invented.
- Recommendations are **Вариант 1/2/3**, explicitly presented as alternatives. Cards include catalog duration/format and the backend-selected next session, or a truthful no-fixed-date state for self-paced events. Backend diagnostics, excluded-event reasons, score and readiness formula are available in disclosure controls. AI source labels require both `explanationSource === "llm"` and nonempty AI text. The existing deterministic snapshot comparison and request cancellation are preserved.
- HR role/grade/department filters use the existing server query contract. Reset clears all filters, empty populations have an explicit message, and all returned rows remain accessible in scrollable tables. Employee accounts have no HR controls.

## Session lifecycle

`AuthLifecycle` holds only in-memory state. Focus/visibility/bfcache return hide and inert the protected subtree until the server confirms the session. An exact same-session confirmation preserves forms and import receipts; a different identity, role, profile binding, expiry or CSRF token revokes requests and mounts a fresh App. Failed checks and current-session 401 responses purge protected data. A late response/401 from an older generation cannot affect the new session.

Logout immediately removes protected content. Failed logout stays locked with an honest retry. Retry first obtains the server's current CSRF token. Expiry also clears failed logout state. Auth calls have bounded cancellation, including response-body delays. BroadcastChannel carries only a logout event, random operation ID and timestamp; peers recheck canonical server state. No credentials, profile payloads, browser storage or client-readable session cookies are used.

## Verification

- Production `next build`: pass, including TypeScript.
- ESLint with `--max-warnings=0`: pass.
- Full suite: **291 passed, 2 skipped**, using `npm test -- --maxWorkers=2 --testTimeout=20000`. The two skipped tests are optional live AI calls; no paid AI requests were made. Earlier parallel runs during development hit the existing 5-second timeout in the all-profile diagnostics test; final verification used the documented larger timeout without weakening assertions or changing backend tests.
- Tests cover backend role/CSRF/origin guards, private history, session expiry/logout, auth lifecycle races, AI stale responses, account response validation and reconciliation, import, completion and persisted SQLite behavior.
- Actual browser flow against the real Next.js dev API and a separate ignored SQLite database: guest sees only login; wrong password gives a neutral error; HR has account/import controls and no completion button; JSON import → preselected account → validated creation → password cleared → CSV import → sign out → new employee login.
- Employee browser flow: no employee picker or HR controls; voluntary completion changed readiness **74.1 → 76.9**, history **2 → 3**, and reload retained both. A real development-route compilation timeout also showed unknown-result recovery and required profile refresh before another completion attempt.
- Two browser tabs: logout in one removed protected profiles and showed login in both. The native file chooser retained selection and the import dialog. The narrow account form and its horizontally scrollable account table were reviewed.
- Final browser review at **1280 × 850** and **390 × 844**: HR account states and duplicate prevention; all three filters; matching population 1, empty population 0 and reset to 201; all 60 skill-gap, 27 follow-up and 40 participation rows in their scrollable tables. New employee login has no HR controls; variant labels, date/format/duration and distinct expected effects render without page overflow. Viewport overrides were reset and the test account signed out.

## Waiting for backend

The current main has no career-goal mutation endpoint. The role/grade catalog is available, but a working goal editor and save action require the backend request/response contract and authorization rules. No fake save button or unsupported mutation has been added. This is the remaining dependent item from the frontend handoff.

## Unverified environment gates

- Docker CLI is installed, but Docker Desktop reported **unable to start** its engine on this host. The Compose workflow could not be exercised here; its configuration is unchanged.
- After the successful production build, the automatic approval review rejected `next start` with the reason **blocked by policy**. Browser evidence above is from the dev server, not a claimed production-server run. The dev server was stopped before building.
- Live OpenAI, corporate SSO/MFA, account recovery, peer-sharing consent and organization-specific access scopes are outside this frontend delivery.

Local test credentials and SQLite data remain under ignored `.data/privacy-ui`; they are not included in Git or this report.

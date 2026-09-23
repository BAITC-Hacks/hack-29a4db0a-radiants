# Private frontend delivery — 2026-09-23

The original frontend handoff started from team `main` at `1e0bab4`, integrated `main` at `1666aeb`, and used branch `feat/private-frontend`. It retained the authenticated App and existing backend routes. The later demo-name selection flow extends the login request/response contract as described in [backend privacy](BACKEND_PRIVACY.md).

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
- The optional shared demo login introduced by main is preserved, remains disabled by default, and has Russian notices only when the server explicitly enables it. The private flow described here uses individual authentication. Demo identities do not prevent HR from creating a personal employee account.
- Demo login accepts the employee's full name and password **admin**. Shared names lead to profile cards showing department, role and grade. Selecting a card finishes login; the user never types an employee ID. The internal ID returned with a card is used only in the follow-up login request.

## Session lifecycle

`AuthLifecycle` holds only in-memory state. Focus/visibility/bfcache return hide and inert the protected subtree until the server confirms the session. An exact same-session confirmation preserves forms and import receipts; a different identity, role, profile binding, expiry or CSRF token revokes requests and mounts a fresh App. Failed checks and current-session 401 responses purge protected data. A late response/401 from an older generation cannot affect the new session.

Logout immediately removes protected content. Failed logout stays locked with an honest retry. Retry first obtains the server's current CSRF token. Expiry also clears failed logout state. Auth calls have bounded cancellation, including response-body delays. BroadcastChannel carries only a logout event, random operation ID and timestamp; peers recheck canonical server state. No credentials, profile payloads, browser storage or client-readable session cookies are used.

## Verification

The results below concern the earlier delivery unless explicitly listed under the current full-name login change. Its automated suite and duplicate-name card flow have not yet been exercised.

- Production `next build`: pass, including TypeScript.
- ESLint with `--max-warnings=0`: pass.
- Full suite after integration with main: **295 passed, 2 skipped**, using `npm test -- --maxWorkers=2 --testTimeout=20000`. The two skipped tests are optional live AI calls; no paid AI requests were made. Earlier parallel runs during development hit the existing 5-second timeout in the all-profile diagnostics test; final verification used the documented larger timeout without weakening assertions or changing backend tests.
- Tests cover backend role/CSRF/origin guards, private history, session expiry/logout, auth lifecycle races, AI stale responses, account response validation and reconciliation, import, completion and persisted SQLite behavior.
- Actual browser flow against the real Next.js dev API and a separate ignored SQLite database: guest sees only login; wrong password gives a neutral error; HR has account/import controls and no completion button; JSON import → preselected account → validated creation → password cleared → CSV import → sign out → new employee login.
- Employee browser flow: no employee picker or HR controls; voluntary completion changed readiness **74.1 → 76.9**, history **2 → 3**, and reload retained both. A real development-route compilation timeout also showed unknown-result recovery and required profile refresh before another completion attempt.
- Two browser tabs: logout in one removed protected profiles and showed login in both. The native file chooser retained selection and the import dialog. The narrow account form and its horizontally scrollable account table were reviewed.
- Final browser review at **1280 × 850** and **390 × 844**: HR account states and duplicate prevention; all three filters; matching population 1, empty population 0 and reset to 201; all 60 skill-gap, 27 follow-up and 40 participation rows in their scrollable tables. New employee login has no HR controls; variant labels, date/format/duration and distinct expected effects render without page overflow. Viewport overrides were reset and the test account signed out.
- After integration with main, the individual-login browser smoke check passed again with `DEMO_EMPLOYEE_LOGIN=false`: no shared-password hint, own Jury Demo profile, persisted 76.9% readiness, three recommendation variants, no HR actions, confirmed logout. A dev preview remains available at `http://127.0.0.1:3100/` using the separate ignored test database.
- Docker Compose build, production startup and container healthcheck passed on revision `0c29cf6`. This supersedes the earlier local Docker-engine and direct `next start` limitations; it does not verify the subsequent full-name login/card changes.

### Current full-name login change

- The first Docker build containing the new login form passed.
- The second Docker integration build passed at `0b1fa90`, including merged `main` at `cedd34d`; TypeScript passed and the container was recreated. No automated test suite was run for this change.
- The form was confirmed in the Docker-served application: the field is labeled **Имя и фамилия**, and there is no instruction to enter an employee ID. This confirms the displayed form, not the complete login flow.
- The current change's automated suite, duplicate-name cards and follow-up selection request have not yet been exercised.

## Remaining frontend integration

Integrated `main` at `cedd34d` now provides `PATCH /api/employees/:employeeId/career-goal`; it permits employees to update only their own goal and returns the updated `EmployeeDetail`. The remaining frontend work is the role/grade editor using `catalog.roleProfiles`, save/clear actions, validation and uncertain-result recovery, plus AI cancellation and profile replacement around the mutation. Clearing an explicit goal can restore the default next-grade target. The API contract and authorization rules are documented in [the completion and career-goal handoff](FRONTEND_COMPLETION_GOAL_HANDOFF.md); this is now frontend integration work, not a missing backend endpoint.

## Remaining validation and scope

- End-to-end full-name demo login, duplicate-name selection cards and the follow-up login request still need their checks. The Docker form inspection above does not replace those checks; earlier test counts are not results for this change.
- Live OpenAI, corporate SSO/MFA, account recovery, peer-sharing consent and organization-specific access scopes are outside this frontend delivery.

Local test credentials and SQLite data remain under ignored `.data/privacy-ui`; they are not included in Git or this report.

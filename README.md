# Career Quest

Career Quest is the HackAlem AI / Halyk Bank employee development navigator. The existing React interface now runs inside Next.js and reads the official catalog through the API. SQLite persists completions and imports; the shared AI/Data engine from PR #1 computes all employee and HR views.

## Run

With Docker and Compose installed:

```bash
docker compose up --build
```

Open http://localhost:3000. Start Docker Desktop first on Windows. Healthcheck creates and seeds the database automatically: 200 employees, 40 events, 60 skills, 32 role profiles and 2,743 history records. Restarting or recreating the container retains subsequent changes in the named volume. Frontend, API and SQLite run in this one service; no separate Node or database startup is required. Set `APP_PORT=3001` in `.env` if port 3000 is occupied.

Stop: `docker compose down`. Explicitly reset demo data: `docker compose down -v` (deletes the volume).

### Sign in and privacy

The first healthcheck generates local accounts `hr-admin`, `employee` (E0178), and `employee2` (E0058), with different random passwords. The operator retrieves them locally:

```bash
docker compose exec app cat /app/.data/initial-access.json
```

For `npm run dev`, read `.data/initial-access.json` after the first page/API request. Credentials are never returned by an HTTP endpoint. Keep this file private; distribute each employee only their own credentials. Existing volumes are migrated without resetting employee data.

Employee sessions can read only their own profile/history and complete their own activities. HR can browse profiles, view analytics, import data and create employee accounts; HR cannot mark activities complete on someone's behalf. Private APIs enforce these rules even for manually crafted requests. Sessions expire after 8 hours; logout revokes them. There is no public employee leaderboard or peer profile sharing.

Compose binds to `127.0.0.1` by default. For deployment behind an internal HTTPS proxy, configure `APP_BIND_ADDRESS` and the exact browser-facing `APP_ORIGIN` (also enables Secure cookies). `AI_EXPLANATIONS_ENABLED=false` disables external AI requests. See [backend privacy and auth contract](docs/BACKEND_PRIVACY.md) and [the frontend implementation plan](docs/FRONTEND_PRIVACY_PLAN.md).

Local development requires Node.js 22+:

```bash
npm ci
npm run dev
```

The native SQLite dependency may require platform C++ build tools if a prebuilt binary is unavailable. Docker includes the required build tools.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The teammate's recommendation, AI mock, HR, import and adapter tests are preserved. Backend integration tests use temporary SQLite files. They verify transactions, import rollback, HTTP errors, persistence and the E0178 regression (71.3 → 74.1 readiness with no assessed-skill mutation).

The previous Vite entry is retained for frontend development: `npm run dev:demo` or `npm run build:demo`. Despite the historical script name, it now uses the same API and proxies /api to the Next.js server on port 3000. Set backend `APP_ORIGIN=http://localhost:5173` for Vite development (or the actual Vite preview origin); otherwise protected POSTs correctly reject its different Origin. Next.js/Compose is the complete application startup.

## Architecture and ownership

```text
Official JSON files + parsed CSV
  -> adaptStarterDataset (PR #4)
  -> transactional SQLite seed
  -> repositories
  -> normalizeDataset
  -> getEmployeeView / buildHrSummary (PR #1)
  -> Next.js API
  -> React product UI
```

- AI/Data: `src/types/career.ts`, `src/lib/recommendation`, `src/lib/data`, `src/lib/analytics`, `src/lib/ai`.
- Backend: `src/server`, `src/app/api`, `src/contracts`, dependencies, application config and Docker.
- Frontend: `src/components`, `src/styles`, `src/lib/frontend` and application pages.

The teammate's refined frontend design is included, preserving cancellation, mutation recovery and decimal progress components. Shared domain types are not redefined; `src/contracts/types.ts` re-exports them. Public API extensions are in `src/contracts/api.ts`.

Completion appends one `LOCAL_<uuid>` history record in a transaction, then rebuilds the shared view. It does not increment assessed `employee.skills`. Teaching caps limit gains without lowering existing attained skills. Availability uses the fixed snapshot `2026-10-01`.

AI/Data completion-policy handoff: [pure eligibility guard and single-event preview](docs/COMPLETION_POLICY_HANDOFF.md). **Integration is pending on this branch:** the current completion route still bypasses prerequisites. The new ordinary HTTP regression intentionally fails until Backend calls the guard inside the transaction; do not merge with that failure or describe the bypass as fixed. The preview replays a virtual history record through the existing engine and does not change the public API or UI.

See [backend handoff](docs/BACKEND_HANDOFF.md), [starter adapter](docs/STARTER_DATASET_ADAPTER.md), [domain progress validation](docs/PROGRESS_VALIDATION.md), and [earlier frontend review](docs/FRONTEND_INTEGRATION_REVIEW.md). The earlier review describes the pre-API revision.

## API

Every success is `{ data: ... }`; errors are `{ error: { code, message, details } }`.

| Endpoint | data |
| --- | --- |
| GET /api/health | status, schemaVersion, counts |
| POST /api/auth/login | AuthSession; sets HttpOnly cookie |
| GET /api/auth/session | AuthSession (user, expiresAt, csrfToken) |
| POST /api/auth/logout | signedOut; revokes session and clears cookie |
| GET /api/hr/accounts | HR-only account list without passwords |
| POST /api/hr/accounts | HR creates an employee account |
| GET /api/catalog | events, skills, roleProfiles; no employee history |
| GET /api/employees | items: EmployeeCard[], total |
| GET /api/employees/:id | EmployeeView + activityHistory, completedActivities, activeMandatoryObligations, recommendationDiagnostics |
| GET /api/employees/:id/recommendations | Same shared employee view |
| POST /api/employees/:id/activities/:eventId/complete | activity, view, progress: { before, after, delta } |
| POST /api/import | employeesInserted, employeesUpdated, historyInserted, historySkipped |
| GET /api/hr/summary | Shared HrSummary + population, statuses, assignedBy, completionRate, totalGapSeverity, employeesWithoutTarget |

Employee filters: `search`, `role`, `grade`, `department`. HR filters: `role`, `grade`, `department`. Matching filters combine with AND.

All endpoints except health/login require a session. All POSTs require the matching `Origin`; authenticated POSTs additionally require `X-CSRF-Token` from AuthSession. Success/error envelopes stay unchanged. 401 means sign in, 403 means forbidden role/CSRF/origin; 429 limits repeated failed logins. JSON bodies are limited to 64 KiB and multipart import to 10 MiB (413 on excess).

Completion body: `{ completedAt?: "YYYY-MM-DD", score?: 0..100, feedbackRating?: 1..5 }`. Send `{}` for defaults. Self-paced completion defaults to the snapshot date; scheduled completion uses the next session. Non-repeatable duplicate completion returns 409; EV_036 can repeat.

Import uses multipart/form-data with `employees` (JSON) and/or `history` (CSV), as uploaded files or text fields. JSON accepts one employee, an array or the official `{ meta, employees }` wrapper. The endpoint accepts both files together; the teammate dialog currently uploads one file at a time. Existing employees update, new employees insert and duplicate record IDs skip. All input and the combined dataset are validated by the shared adapter. A failed row rolls back the entire request. Catalog replacement is not exposed through this incremental-import endpoint.

Error codes: 400 invalid JSON/multipart or empty import; 422 validation/reference errors; 404 missing employee/event; 409 duplicate completion. Import details include file, row, field and reason.

## Recommendations and AI status

The shared engine returns up to three eligible voluntary recommendations with reasons, expectedChanges (before/after/required), historySignal and deterministicExplanation. It considers target gaps, critical requirements, audience, prerequisites, availability and participation history. A Lead without a career goal has `targetStatus: "needs_career_goal"`, readiness 0 and no recommendations. Empty recommendation lists are valid.

Readiness is the weighted mean of `min(current / required, 1)`: critical requirements weigh 2, others weigh 1, then multiply by 100 and round to one decimal. Zero-level requirements are fulfilled. This is a development indicator, not a promotion probability. Recommendations are alternative next steps evaluated against the current profile, not a precomputed sequential course plan.

Ranking awards 40 points per reduced critical gap level and 10 per other reduced gap level. History uses the previous 365 days at the fixed snapshot. Matching type/format plus a shared developed skill gives a strong signal: each no-show/drop/decline costs 10, or 5 for declining an external assignment. Same-type/format records on unrelated topics cost only 2 (1 for external declines), capped at 6; total negative adjustment is capped at 30. Feedback adds 5 for a mean of at least 4, subtracts 5 for at most 2, and applies only to the related-topic group. These are transparent heuristic weights, not learned or empirically calibrated preferences. Sparse history is reported as insufficient evidence. Attendance is not a judgment of employee performance.

The profile and completion routes return deterministic data immediately. `GET /api/employees/:id/recommendations` reconstructs that same profile from SQLite and enriches only its selected recommendations with OpenAI explanations. The response remains `{ data: EmployeeDetail }`, including completed activities. No client-supplied dataset or Vite middleware is involved; AI requests run outside database transactions.

The provider has an 8-second deadline. The route starts a 9.5-second budget before resolving its parameters, leaving 0.5 seconds for serialization/transport toward the under-10-second target. Time spent reconstructing the profile reduces the available provider budget. Missing keys, network failures, refusals and invalid evidence leave `explanationSource: "fallback"`; valid text sets it to `"llm"`. Event IDs, ordering, scores and skills never come from the model. References must include target, history and an actually reduced skill gap. These checks do not prove every natural-language sentence true; factual evidence remains available independently of AI text.

Set server-only `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in the ignored `.env`. Both `docker compose up --build` and local Next.js development load it. If using `.env.local` instead, pass `docker compose --env-file .env.local up --build`. Recreate the container to apply changed environment values. Env files are excluded from Git and the Docker build context. Do not expose a key through `NEXT_PUBLIC_*` or `VITE_*`. The default model is `gpt-6-astra`, with low reasoning effort for this bounded explanation task.

The frontend fetches AI explanations separately while the deterministic plan stays usable. Selection, completion, navigation and import cancel outstanding requests. Late responses are discarded, including same-employee responses with old evidence; only explanation text and source can change. Cards label AI-assisted and rule-based explanations separately. Completed activities and active mandatory obligations remain visible independently of recommendations.

`npm test` uses mocked transports and skips live checks. `npm run test:ai-live` explicitly makes billed requests against the official synthetic dataset in a temporary SQLite database, and fails if it receives fallback. Use `npm run test:ai-live -- -t E0178` for one request. See [AI verification](docs/AI_VERIFICATION.md).

## Environment

Defaults: `CAREER_QUEST_DB_PATH=.data/career-quest.sqlite`, `CAREER_QUEST_DATA_DIR=data`. Compose supplies absolute /app paths. The .env.example file contains optional local overrides. Secrets and SQLite files are excluded from Git.

## Demo

1. Sign in as `employee`, linked to E0178. On a clean database: readiness 71.3%.
2. Complete EV_005: skills refresh, readiness becomes 74.1%, API Design stays at 4.
3. Reload: the completed history and updated progress remain.
4. Sign out, sign in as `hr-admin`, then import [jury-employee.json](docs/fixtures/jury-employee.json), then [jury-history.csv](docs/fixtures/jury-history.csv) using **Import another file**. Jury Demo changes from 71.3% to 74.1%; completed and overdue mandatory activity history appears.
5. Open HR: official population, gaps, all employees without steps, and all activity participation rows are accessible.

See [jury rehearsal](docs/JURY_DEMO.md) for the three importable evaluation profiles, adversarial checks and a three-minute demonstration. [Release checklist](docs/RELEASE_CHECKLIST.md) separates verified behavior from the remaining live-AI and frontend gates.

Starter data is synthetic. Server sessions and role checks protect employee/HR access. Employee listing and catalog endpoints do not expose engagement history. Corporate SSO, account recovery, consent-based peer sharing and an organizational retention policy remain deployment work; this local account system is the hackathon implementation.

See [the 3–5 minute demo and startup guide](docs/DEMO.md), [the frontend API contract](docs/FRONTEND_API.md), [previous validation results](docs/FINAL_VALIDATION.md), and [privacy integration validation](docs/PRIVACY_VALIDATION.md).

Authenticated real-AI screenshots for E0058, the deployed build SHA and the saved successful live-test output are in [LIVE_AI_PROOF.md](docs/LIVE_AI_PROOF.md).

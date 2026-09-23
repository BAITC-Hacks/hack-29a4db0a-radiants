# Career Quest

Career Quest is the HackAlem AI / Halyk Bank employee development navigator. The existing React interface now runs inside Next.js and reads the official catalog through the API. SQLite persists completions and imports; the shared AI/Data engine from PR #1 computes all employee and HR views.

## Run

With Docker and Compose installed:

```bash
docker compose up --build
```

Open http://localhost:3000. Healthcheck creates and seeds the database automatically: 200 employees, 40 events, 60 skills, 32 role profiles and 2,743 history records. Restarting or recreating the container retains subsequent changes in the named volume.

Stop: `docker compose down`. Explicitly reset demo data: `docker compose down -v` (deletes the volume).

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

The previous Vite entry is retained for frontend development: `npm run dev:demo` or `npm run build:demo`. Despite the historical script name, it now uses the same API and proxies /api to the Next.js server on port 3000. Next.js/Compose is the complete application startup.

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

The frontend API branch at 92dd0fd is included, preserving its cancellation, mutation recovery and decimal progress components. The separate backend domain implementation has been removed. Shared domain types are not redefined; `src/contracts/types.ts` re-exports them. Public API extensions are in `src/contracts/api.ts`.

Completion appends one `LOCAL_<uuid>` history record in a transaction, then rebuilds the shared view. It does not increment assessed `employee.skills`. Teaching caps limit gains without lowering existing attained skills. Availability uses the fixed snapshot `2026-10-01`.

See [backend handoff](docs/BACKEND_HANDOFF.md), [starter adapter](docs/STARTER_DATASET_ADAPTER.md), [domain progress validation](docs/PROGRESS_VALIDATION.md), and [earlier frontend review](docs/FRONTEND_INTEGRATION_REVIEW.md). The earlier review describes the pre-API revision.

## API

Every success is `{ data: ... }`; errors are `{ error: { code, message, details } }`.

| Endpoint | data |
| --- | --- |
| GET /api/health | status, schemaVersion, counts |
| GET /api/catalog | events, skills, roleProfiles; no employee history |
| GET /api/employees | items: EmployeeCard[], total |
| GET /api/employees/:id | EmployeeView + completedActivities, activeMandatoryObligations |
| GET /api/employees/:id/recommendations | Same shared employee view |
| POST /api/employees/:id/activities/:eventId/complete | activity, view, progress: { before, after, delta } |
| POST /api/import | employeesInserted, employeesUpdated, historyInserted, historySkipped |
| GET /api/hr/summary | Shared HrSummary + population, statuses, assignedBy, completionRate, totalGapSeverity, employeesWithoutTarget |

Employee filters: `search`, `role`, `grade`, `department`. HR filters: `role`, `grade`, `department`. Matching filters combine with AND.

Completion body: `{ completedAt?: "YYYY-MM-DD", score?: 0..100, feedbackRating?: 1..5 }`. Send `{}` for defaults. Self-paced completion defaults to the snapshot date; scheduled completion uses the next session. Non-repeatable duplicate completion returns 409; EV_036 can repeat.

Import uses multipart/form-data with `employees` (JSON) and/or `history` (CSV), as uploaded files or text fields. JSON accepts one employee, an array or the official `{ meta, employees }` wrapper. The endpoint accepts both files together; the teammate dialog currently uploads one file at a time. Existing employees update, new employees insert and duplicate record IDs skip. All input and the combined dataset are validated by the shared adapter. A failed row rolls back the entire request. Catalog replacement is not exposed through this incremental-import endpoint.

Error codes: 400 invalid JSON/multipart or empty import; 422 validation/reference errors; 404 missing employee/event; 409 duplicate completion. Import details include file, row, field and reason.

## Recommendations and AI status

The shared engine returns up to three eligible voluntary recommendations with reasons, expectedChanges (before/after/required), historySignal and deterministicExplanation. It considers target gaps, critical requirements, audience, prerequisites, availability and participation history. A Lead without a career goal has `targetStatus: "needs_career_goal"`, readiness 0 and no recommendations. Empty recommendation lists are valid.

Current routes call the deterministic shared engine and return `explanationSource: "fallback"`; no network model call or key is required. The existing `src/lib/ai` provider and its mocked tests are preserved. Live provider wiring and verification remain a separate teammate step requiring server-side key setup. The frontend already renders `aiExplanation ?? deterministicExplanation`. Merely setting OPENAI_API_KEY does not enable model calls in this revision.

## Environment

Defaults: `CAREER_QUEST_DB_PATH=.data/career-quest.sqlite`, `CAREER_QUEST_DATA_DIR=data`. Compose supplies absolute /app paths. The .env.example file contains optional local overrides. Secrets and SQLite files are excluded from Git.

## Demo

1. Open E0178 on a clean database: readiness 71.3%.
2. Complete EV_005: skills refresh, readiness becomes 74.1%, API Design stays at 4.
3. Reload: the completed history and updated progress remain.
4. Import an additional profile, optionally with its history in the same request.
5. Open HR: official population, gaps, all employees without steps, and all activity participation rows are accessible.

Starter data is synthetic. Authentication is outside this MVP: employee/HR views are logically separated but not protected by an authorization layer. Employee listing and catalog endpoints do not expose engagement history.

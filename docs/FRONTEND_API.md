# Frontend API handoff

The React interface runs inside Next.js and uses relative `/api/...` requests. SQLite is the source of truth. The optional Vite development entry proxies API requests to the same Next.js server; it is not a second backend.

## Current HTTP contract

All successful responses are `{ data: ... }`. Errors are `{ error: { code, message, details } }`. Shared types live in `src/types/career.ts`; server response extensions live in `src/contracts/api.ts`.

| Endpoint | Data |
| --- | --- |
| GET `/api/catalog` | Shared `CatalogResult`: events, skills, role profiles; no employee history |
| GET `/api/employees` | `{ items: EmployeeCard[], total }` |
| GET `/api/employees/:id` | Deterministic `EmployeeDetail` |
| GET `/api/employees/:id/recommendations` | The same `EmployeeDetail` with optional validated AI explanation text |
| POST `/api/employees/:id/activities/:eventId/complete` | `{ activity, view: EmployeeDetail, progress: { before, after, delta } }` |
| POST `/api/import` | `{ employeesInserted, employeesUpdated, historyInserted, historySkipped, employeeIds }` |
| GET `/api/hr/summary` | Shared HR summary with server-calculated population, completion rate and participation aggregates |

Encode employee/event IDs as URL path segments. Completion sends `{}` for demo date defaults. Import sends the original file as multipart field `employees` for JSON or `history` for CSV. Import JSON first for a new employee, then their CSV history; each upload is a separate atomic request. Official skill/event catalogs are initialized by the server and are not replaced through this UI.

## Fast profile, asynchronous explanations

Render the deterministic profile or completion response immediately. Request the recommendation endpoint separately. It uses persisted server data, never a browser-supplied dataset. Preserve the deterministic view while it loads or fails.

The AI result may update only explanation fields for the matching employee and current deterministic snapshot. Abort/discard old requests after employee selection, screen change, completion or import. An older result for the same employee must not overwrite a newer completion. `explanationSource: "llm"` with nonempty `aiExplanation` identifies AI text; `fallback` uses the deterministic explanation. The server caps its provider at 8 seconds and the request budget at 9.5 seconds.

## Progress, history and recovery

- EmployeeDetail extends EmployeeView with `completedActivities` and `activeMandatoryObligations`. Display them separately; mandatory events never enter career recommendations.
- Render readiness with at most one decimal. Completion feedback uses the actual before/after response and percentage-point delta.
- Skills and ranking are computed by the server. Never increment assessed `employee.skills` in the browser.
- Catalog loading supplies skill names without blocking the profile. A missing target still displays all supplied effectiveSkills; skills outside target requirements have a separate table. IDs remain visible if the catalog is unavailable.
- Recommendation expectedChanges are previews. Compare effectiveSkills before/after completion for actual progress.
- On an uncertain completion outcome, reload the profile rather than automatically retrying the POST. Duplicate non-repeatable completion is rejected by the server.
- Import success with a failed profile refresh retries the read, not the already committed upload.
- HR renders server aggregates; navigation separation is not real authorization in this hackathon MVP.

## Local commands

Full app: `docker compose up --build`, or `npm ci` followed by `npm run dev` with Node.js 22+. Open port 3000. `APP_PORT` changes the published Docker port if needed.

Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Live OpenAI checks are opt-in and bill normal API usage. See `AI_VERIFICATION.md`, `BACKEND_HANDOFF.md` and `DEMO.md` for the final scenario and verification scope.

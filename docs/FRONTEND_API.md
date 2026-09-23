# Frontend API handoff

## Current integration

The Next.js frontend uses same-origin `/api` routes and shared domain types. The frontend branch includes `main` through `06b46ad` (verified backend AI integration). No recommendation, eligibility, readiness, progression, or HR formulas run in the UI.

## HTTP contracts

All current success responses use `{ data }`. IDs are URL-encoded in the adapter.

| Method and path | Request | Data used by frontend |
| --- | --- | --- |
| GET `/api/employees` | — | `EmployeeListResult.items`, mapped to selector entries |
| GET `/api/employees/:id` | — | Fast `EmployeeDetail`: profile, readiness, effective skills, target gaps, deterministic recommendations, available history |
| GET `/api/employees/:id/recommendations` | AbortSignal | `EmployeeDetail`; adapter extracts **only** `recommendations` |
| GET `/api/catalog` | — | Skill names and event titles/durations from `CatalogResult` |
| POST `/api/employees/:id/activities/:eventId/complete` | JSON `{}` | `CompleteActivityResult.view` replaces the profile |
| POST `/api/import` | Original JSON in `employees` or CSV in `history` multipart field | Import counts; refresh list and profile |
| GET `/api/hr/summary` | — | Shared HR aggregates; server population/completion rate map to optional metrics |

The adapter retains compatibility with direct legacy views and success-only completion responses. A confirmed completion without a view triggers one GET. An uncertain mutation is never automatically repeated. Runtime response guards check shape and employee identity. Null optional AI text is normalized to absent; domain values are not recalculated. Requests time out after 10 seconds.

## Independent asynchronous state

1. Load and render the profile immediately. Catalog loading does not block it.
2. Start recommendations for `{ employeeId, profileRevision }` after the profile succeeds.
3. Display deterministic recommendations while explanations load, with a local loading indicator. AI failure leaves the profile and deterministic cards usable and offers a separate retry.
4. Every successful profile fetch or replacement advances the local profile revision.
5. Each recommendation request owns a monotonically increasing request generation and an AbortController. A result is accepted only if generation, employee ID, profile revision and enabled state still match.
6. Employee selection, completion start, import start, profile refresh, leaving employee view and unmount invalidate old requests. Render also checks the employee/revision pair, so a previous response cannot flash before effect cleanup.
7. Completion clears recommendation state before POST, retains the profile while pending, replaces it with the committed view and starts a new request. Uncertain completion requires profile recovery first.
8. Import cancels before upload, refreshes employees, selects an affected/new/current profile, and reloads the profile before recommendations resume. An uncertain upload also triggers a fresh profile read. Retry after a confirmed upload retries refresh only, never reuploads the same mutation.

Recommendation responses never replace profile state: readiness, assessed/effective skills, target, grade, employee details and activity history are updated only through the profile/mutation flow. Background refresh keeps the current profile visible; failed refresh is explicitly reported.

## Presentation

- `employee.skills` remains assessed baseline. Current skill progress uses the server's `skillGaps.currentLevel` and `effectiveSkills`.
- Readiness labels and actual completion differences preserve decimal precision. Differences are percentage points; zero-change completion does not invent an increase.
- Additional skills are entries of `effectiveSkills` absent from target gaps, including zero levels. A profile without a target still shows its effective skills, using catalog names or IDs as fallback. No fabricated required level is shown.
- Explanation text is trimmed nonempty `aiExplanation`, otherwise `deterministicExplanation`. Small source text is **AI-assisted** or **System explanation**, based on the displayed text, regardless of a contradictory `explanationSource` field. Structured reasons remain visible.
- History combines/deduplicates available records, filters to the current employee, and sorts ISO dates newest first without mutating the API data. Its compact scrollable table retains every returned row, status, date, completion, initiator and available catalog duration.

## Backend follow-ups and limits

- `EmployeeDetail` currently supplies only `completedActivities` and `activeMandatoryObligations`. Noncompleted voluntary activities are omitted. The UI states this scope. To show the complete timeline, backend should supply a full `ActivityView[]` history field or endpoint. The renderer already supports Completed, In progress, Dropped, Declined, No show and Overdue.
- Import currently returns counts but no affected employee IDs. New IDs are detected from the refreshed list; updating an existing nonselected employee retains the current selection. Returning `employeeIds` would allow precise automatic selection.
- Revisions are local. A concurrent external change in another browser is not detected until refresh; a server revision echoed by recommendations would strengthen this contract.
- Live AI is integrated in the backend in `main`. Frontend supplies no credentials and never calls OpenAI directly. Without configured server credentials, deterministic explanations remain valid.

## Validation

See `docs/FRONTEND_ASYNC_VALIDATION.md` for current results. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Start the full app with the README workflow; `dev:demo` is the optional Vite surface.

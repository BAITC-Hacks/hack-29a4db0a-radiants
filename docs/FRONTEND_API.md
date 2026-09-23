# Frontend API handoff

## Status

The React/Vite frontend now uses HTTP exclusively. No domain engine, dataset, file parser, or local-storage persistence is bundled into the application. Shared `Employee`, `EmployeeView`, and `HrSummary` are imported as types. Domain code and PR #1 tests are unchanged.

## Progress display contract

The follow-up audit rechecked the requirements, `docs/PROGRESS_VALIDATION.md`, PR #1's `cd2bc40` update, and current remote branches. The shared view shape and progression formulas remain unchanged.

- `employee.skills` is assessed baseline. Completion must append history server-side and return/refetch a recomputed view; the frontend replaces the view without increasing baseline skills.
- In the actual `calculateSkillGaps` implementation, **`currentLevel` already comes from `effectiveSkills`**; `projectedLevel` is currently initialized to the same value. The task's conditional example of currentLevel being assessed does not apply to this revision. UI labels are **Current progress**, **Projected**, **Required**, rendering each supplied field independently.
- Recommendation `expectedChanges` are previews. Completion feedback compares actual old/new `effectiveSkills`, even if the result differs from the preview.
- `src/lib/frontend/readiness.ts` owns readiness labels, delta precision and visual bounds. Numeric labels and accessible progress text use at most one decimal. Delta is normalized to one decimal before choosing positive/negative/zero feedback; zero reports the unchanged readiness without a +0 achievement. Differences are labeled **percentage points** to distinguish an absolute change in readiness from relative percentage growth.
- Only progress geometry is clamped to 0–100; the returned value and state are unchanged. HTTP response validation continues to reject invalid out-of-range readiness.
- Rejected completion retains the old profile. Uncertain network/server outcomes still require reloading rather than claiming that no server write occurred.

Follow-up checks: TypeScript, lint, all **52 tests** (including unchanged PR #1 tests) and production build pass. New regressions cover 64/64.2 formatting, 64.2 → 71.5 (+7.3), negative and zero deltas, floating point noise, accessible labels, frozen assessed skills and rejected/pending completion. In the built UI with the temporary fixture server, a rejected request retained 87.5%; a delayed successful request disabled the CTA and retained 87.5% until the response, then showed 100%, +12.5 percentage points, actual skill 3 → 4, and NoNextStepState. No console errors or warnings were captured.

**These routes are a proposed integration contract, not an existing server.** At implementation time `main` was `1bf2026`; the published starter adapter branch supplied pure data conversion but no HTTP routes. Backend should implement the routes below or update only `src/lib/frontend/api.ts` to match its routes/envelopes.

## HTTP contract

Default prefix: `/api`. Successful bodies are JSON unless explicitly listed as empty.

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/employees` | — | `Employee[]` from `src/types/career.ts` |
| GET `/employees/:employeeId` | URL-encoded ID | `EmployeeView` from the shared types |
| POST `/activities/complete` | JSON `{ employeeId, eventId }` | Updated `EmployeeView`, `{ success: true }`, or empty 2xx/204 |
| POST `/import` | Multipart form field `file`; original JSON/CSV file | `{ success?: true, employeeIds?: string[], warnings?: string[], message?: string }` or empty 2xx/204 |
| GET `/hr/summary` | — | `HrSummary` from `src/lib/analytics/hr-summary.ts`, with optional `metrics` described below |

Completion success without a view triggers a fresh GET. The response must contain the requested employee ID. A failed GET after confirmed completion offers **Reload profile**, which sends only GET. Timeouts, network errors, unexpected responses and 5xx leave completion status uncertain; the UI does not automatically retry POST. Backend must reject failed writes atomically, enforce eligibility and prevent duplicate completion records. Treat 400/401/403/404/409/422 as rejected mutations with no committed change.

Non-2xx errors may return `{ message: string }`, `{ error: string }`, or `{ error: { message: string } }`. Messages are rendered as text. Requests time out after 10 seconds. Profile selection cancels stale GETs; duplicate completion/upload clicks are disabled while pending.

## Backend responsibilities

- Load all official starter files into a normalized `CareerDataset` before exposing profiles. The starter adapter branch can assist; CSV parsing, persistence and routes still belong to the server.
- Return complete shared shapes. Runtime guards check response structure; they do not calculate or normalize domain values.
- Compute target, readiness, effective skills, gaps, ordered recommendations, scores, expected changes and deterministic reasons on the server.
- Complete an activity by appending history, then rebuild `EmployeeView`. Do not also increase assessed skills. Return the committed view or acknowledge success only after the write succeeds.
- Parse and validate imports server-side. The browser checks filename extension only. Return affected `employeeIds` so an updated existing profile opens reliably; otherwise the UI selects a newly observed ID or retains the current profile.
- Expose `buildHrSummary` output as supplied, without asking the browser to aggregate employees. All returned rows are accessible.
- Provide authentication, authorization and durable storage in the backend as required by the deployment. The HR navigation itself is not access control.

## Fields not currently available

The UI adapts to the existing domain types without extending them:

- `HrSummary` has no total employee count, completion percentage or catalog coverage. These cards stay hidden unless the transport supplies optional `metrics: { totalEmployees?: number, completionRate?: number, coverage?: number }`. Rates use 0–100. Backend must define their denominator/meaning before populating them.
- `EmployeeView` has no detailed no-recommendation reason. Empty recommendations show a generic message; `targetStatus: "needs_career_goal"` adds the explicit goal prompt. Catalog exhaustion, blocked prerequisites and insufficient data need a server reason field before the UI can distinguish them.
- Expected changes contain skill IDs, not names. Names are resolved from supplied skill gaps, with the ID as a fallback. An optional server skill-name dictionary would improve names for changes outside target requirements.
- Recommendation status, duration and format are not supplied. No invented availability/status or duration is shown; `nextSession` appears only when present.
- Optional nonempty `aiExplanation` appears as **AI insight**. All deterministic reasons remain visible without it. No browser OpenAI request or API key is involved. A live server AI endpoint/key was not available or verified in this iteration.

## Configuration

For a separate local backend, copy `.env.example` to `.env.local`, set `CAREER_API_TARGET`, then run `npm run dev`. Vite forwards `/api` without changing the path. For production, serve `/api` behind the same origin or configure `VITE_API_BASE_URL` at build time and backend CORS. `CAREER_API_TARGET` only affects the development proxy. Cookies use `same-origin`; cross-origin credentialed authentication requires a separately agreed setup.

With no backend configured, the app intentionally shows a recoverable API error. It does not silently substitute synthetic employees. Test fixtures under `tests/fixtures` are not production data.

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Frontend tests cover transport shapes, opaque uploads, success-only completion refetch, mutation uncertainty, malformed responses, timeout/cancellation, optional AI, empty recommendations, unmodified server totals, decimal readiness and actual before/after changes. PR #1 engine, HR and AI tests remain included. Browser checks against a temporary fixture server validate the UI only; repeat the full flow against the backend once published.

### Results for this iteration

- TypeScript, ESLint, production build and all 37 tests passed (including the unchanged 17 PR #1 tests).
- Built application, temporary local fixture API: employee selection, readiness/gaps/reasons, completion 87.5% → 100% and System design 3 → 4, no-next-step state, multipart upload and selection of the imported profile, HR counts all passed.
- Confirmed completion followed by a simulated failed profile GET recovered through **Reload profile**, showing 41.7% → 54.2% and SQL 2 → 3. Request log confirmed one POST per completion, with no repeated mutation during recovery.
- Optional AI text appeared when supplied and was absent without an error otherwise. A delayed old employee response did not overwrite the newer selection. Loading state and HR error/retry were observed.
- Responsive checks at 1440, 1366, 1024, 768 and 390 px found no document-level horizontal overflow. No browser console errors/warnings were captured during these checks.
- Real HTTP backend, official dataset upload/persistence and live OpenAI remain unverified because no server routes were published. The fixture server is outside the repository and is not part of the shipped frontend.

# Backend integration handoff

Backend base merged to main: `457f608` (PR #8, including PRs #3/#5).

AI integration builds on PR #9 (`3fe01d5`) and adds request-budget checks, additional runtime regressions and live verification. PR #6's old Vite handler is superseded; do not restore it. Frontend included in the backend base is `92dd0fd`.

## Shared contract

The authoritative domain types remain in `src/types/career.ts`. Backend now uses `adaptStarterDataset -> normalizeDataset -> getEmployeeView / buildHrSummary`. The duplicate backend recommendation engine and its incompatible DTOs have been removed.

`GET /api/employees/:id` and `GET /api/employees/:id/recommendations` return `{ data: EmployeeDetail }`. EmployeeDetail extends EmployeeView, adding completedActivities and activeMandatoryObligations. Recommendation fields are eventId, title, reasons, expectedChanges, historySignal, nextSession, deterministicExplanation, aiExplanation?, explanationSource. Readiness is a number, possibly with one decimal place. No-target state is `needs_career_goal`.

Only the recommendations endpoint invokes OpenAI. Profile and completion return deterministic data without waiting for AI. The provider deadline is at most 8 seconds; the recommendation route budgets 9.5 seconds from handler entry, including profile reconstruction, with fallback on exhaustion. Responses use `Cache-Control: no-store`. LLM calls happen outside SQLite transactions. No new route or second set of domain types is introduced.

Completion returns:

```ts
{
  data: {
    activity: ActivityRecord,
    view: EmployeeDetail,
    progress: { before: number, after: number, delta: number }
  }
}
```

Only the completed history row is persisted. Assessed skills remain unchanged. The response is recomputed while the SQLite transaction remains open.

`GET /api/hr/summary` preserves the shared HrSummary fields (weakCompetencies, employeesWithoutRecommendations, participationByEvent) and adds aggregate fields from the API contract. Filters apply to both employees and their history.

`GET /api/catalog` supplies events, skills and roleProfiles for display. It contains no employee engagement data. Employee cards come from `GET /api/employees`.

## Frontend integration performed

Existing App.tsx and styles are hosted by Next.js. Browser calculations/localStorage have been replaced in the active product flow by relative API calls. Completion displays readiness delta and before/after skills. The API accepts one JSON and/or one CSV in a single transaction; the teammate dialog currently uploads one file at a time. HR lists are no longer silently truncated. The historical Vite entry remains available with an API proxy; demo fixtures are now test-only.

The UI reads the canonical EmployeeDetail, displays deterministic data immediately, then fetches explanations separately. AI text is displayed only for `explanationSource: "llm"` with nonempty text. Completion and import reload the persisted view; completed activities and active mandatory obligations have their own tables. No duplicated skill arithmetic is performed by the browser.

## Import semantics

The official four-file seed is validated by PR #4's adapter. Partial imports upsert employees and skip existing record IDs; references may point to an employee introduced in the same request. The combined persisted dataset is validated before commit. All invalid records roll back together. CSV numeric and optional-empty conversion is delegated to parseActivityHistoryRows. JSON rows use the existing canonical fields.

The endpoint does not replace the event/skill catalog; it is an incremental employee/history importer. The catalog comes from the four official files, with exact starter counts. No browser demo records are mixed into SQLite.

## НАПАРНИК/И — integration contract

- AI/Data: PR #5 is merged; PR #9 supplies the persisted explanation service and evidence validation. Backend verification passed with the real server key. Keep the canonical types/engine and the 8-second provider deadline.
- Frontend: separate fetching is implemented. Keep the fast profile/completion flow and exact deterministic-evidence comparison before overlaying AI text. Employee change, completion, navigation and import abort pending requests; canceled responses cannot overwrite current progress even if a transport ignores abort.
- Import: retain the jury flow JSON then CSV. Catalog initialization is already server-owned. Combined upload UI remains optional.

## Environment and checks

Put server-only `OPENAI_API_KEY` and optional `OPENAI_MODEL` in ignored `.env`. Compose reads it automatically; Next.js loads it in development. With no key, the same route returns deterministic fallback. `.env.local` also works locally; Compose requires `--env-file .env.local` for that filename. Never commit the key or use a public frontend env prefix.

Verified: 176 offline tests, TypeScript, frontend/hooks lint, fresh-clone Docker build, two live service cases and actual browser AI/fallback. Tests include stale AI response rejection, source labeling, completed/mandatory history, no-target skills and JSON → CSV jury import through real API routes with rollback and persistence. See FINAL_VALIDATION.md for observed results and AI_VERIFICATION.md for scope and limitations.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Start the complete app with `docker compose up --build`. See README for reset and environment options. Example API responses are under `docs/fixtures`.

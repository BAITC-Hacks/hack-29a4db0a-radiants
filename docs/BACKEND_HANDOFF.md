# Backend integration handoff

Integration branch: `feature/backend-docker`.

Included main at `1bf2026`, PR #2 (`3f55129` tests), PR #3 (`a1a5ed` review notes), and PR #4 (`56a2dec` adapter). PR #1 is already in main. Main is not changed by this branch.

## Shared contract

The authoritative domain types remain in `src/types/career.ts`. Backend now uses `adaptStarterDataset -> normalizeDataset -> getEmployeeView / buildHrSummary`. The duplicate backend recommendation engine and its incompatible DTOs have been removed.

`GET /api/employees/:id` and `GET /api/employees/:id/recommendations` return `{ data: EmployeeDetail }`. EmployeeDetail extends EmployeeView, adding completedActivities and activeMandatoryObligations. Recommendation fields are eventId, title, reasons, expectedChanges, historySignal, nextSession, deterministicExplanation, aiExplanation?, explanationSource. Readiness is a number, possibly with one decimal place. No-target state is `needs_career_goal`.

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

Existing App.tsx and styles are hosted by Next.js. Browser calculations/localStorage have been replaced in the active product flow by relative API calls. Completion displays readiness delta and before/after skills. Imports send one JSON and/or one CSV in a single transaction. HR lists are no longer silently truncated. The historical Vite entry remains available with an API proxy; standalone localStorage helpers remain only for their existing regression tests.

The UI reads recommendations from EmployeeView, displays `aiExplanation ?? deterministicExplanation`, and handles request errors and employee-selection cancellation. No duplicated skill arithmetic is performed by the browser.

## Import semantics

The official four-file seed is validated by PR #4's adapter. Partial imports upsert employees and skip existing record IDs; references may point to an employee introduced in the same request. The combined persisted dataset is validated before commit. All invalid records roll back together. CSV numeric and optional-empty conversion is delegated to parseActivityHistoryRows. JSON rows use the existing canonical fields.

The endpoint does not replace the event/skill catalog; it is an incremental employee/history importer. The catalog comes from the four official files, with exact starter counts. No browser demo records are mixed into SQLite.

## НАПАРНИК/И — remaining coordination

- AI/Data: shared engine and public types are preserved. Real OpenAI provider integration/key setup remains a separate step. Current routes intentionally use deterministic fallback; setting a key alone does not invoke it.
- Frontend: App.tsx data loading, completion, import and HR wiring changed in this branch. Base subsequent edits on this integration to avoid restoring localStorage as the source of truth.
- Merge this branch through its PR after integration checks; other PR branches were included locally with their original commits, without changing main directly.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Start the complete app with `docker compose up --build`. See README for reset and environment options. Example API responses are under `docs/fixtures`.

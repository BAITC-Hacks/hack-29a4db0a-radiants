# Completion policy and truthful preview

## Status: domain ready, runtime integration required

Started from main `94496bd` (includes PR #16's authenticated live-AI proof).
Synced with main `1666aeb` (PR #17 optional demo login); final runtime checks below
were repeated at merge commit `131a7b0`. Subsequent changes only update this report
and its test-output artifact.
Owner: AI/Data. Integration owner: Backend, `@silence99999`.

This change does **not** wire the production completion endpoint. Do not merge or
describe the bypass as fixed until Backend integrates the guard and the complete
test suite passes. No API/shared DTO, UI, database, ranking weights or LLM changes
are included. The source module is pure TypeScript, with no filesystem, Next.js,
SQLite or network imports.

Coordination request (policy approval is still pending):
https://github.com/BAITC-Hacks/hack-29a4db0a-radiants/issues/7#issuecomment-5794279358

## Reproduced problem

On fresh official data, E0178 has System Design 1 and EV_006 requires 2. The existing
authenticated HTTP route nevertheless returns 201, appends history (2743 -> 2744),
changes System Design 1 -> 2 and Observability 3 -> 4, and readiness 71.3 -> 74.1.

`tests/completion-integration.test.ts` expects the correct behavior: 422 and no
history/skill/readiness changes. It is an ordinary failing test, not skipped,
inverted with `it.fails`, or changed to accept the bug. Keep this gate intact.

## Pure functions

Import directly from `@/lib/recommendation/completion`:

```ts
checkActivityCompletion(dataset, employeeId, eventId, {})
// { allowed: false, reasons: [{ code, message, missingSkills? }] }
// OR { allowed: true, completedAt, continuingRecordId? }

previewActivityCompletion(dataset, employeeId, eventId, {})
// Same refusal, with no preview on rejection.
// OR { allowed: true, completedAt, continuingRecordId?, preview: {
//   employeeId, eventId, target,
//   progress: { before, after, delta },
//   expectedChanges: [{ skillId, before, after, required, critical }],
//   effectiveSkills, skillGaps
// } }
```

The optional fourth argument accepts `{ completedAt: "YYYY-MM-DD" }`; omit it or
pass `{}` for defaults. `dataset` is the current server-owned `NormalizedDataset`, not a payload supplied
by the browser. Both functions leave arrays, indexes, employee skills and history
unchanged. The context cannot grant assignment, authorization or prerequisite
overrides. Domain exports live in this module; existing shared types are untouched.

## Policy to confirm with Backend

1. Completion does not require top-three membership, a positive score, gap
   reduction or an active career target. A valid activity can still be completed
   when the employee is already ready or is a Lead without a goal.
2. Current **or** target role/grade must match as a pair. Effective skills must
   satisfy prerequisites. These checks also apply to active/mandatory activities.
3. Any previous completed record blocks another completion except for EV_036.
   The domain does not provide transport retry/idempotency protection for EV_036.
4. An active participation means the latest record for this employee/event is
   `in_progress` or `overdue`, dated on/before the snapshot. A later terminal
   record invalidates that continuation. At a same-day tie a terminal status
   wins conservatively; the source schema has dates, not precise timestamps.
5. Mandatory activities are never career recommendations. Proposed completion
   policy requires an active record assigned by `manager` or `hr`. A self-created
   claim, a different employee/event, or a declined/dropped/finished assignment
   cannot unlock it. This is a team policy, not a new requirement attributed to
   the PDF. The existing Backend test allowing unassigned mandatory completion
   must be replaced with an actual assigned fixture after policy agreement.
6. Availability remains anchored to **2026-10-01**, never the machine clock.
   Self-paced activities complete on that date (empty sessions are fine).
   A persisted active participation can finish on that date even if its original
   scheduled session is past; this is not a new enrollment.
7. A new scheduled activity defaults to the nearest session on/after the snapshot.
   An explicit date must be a listed session on/after that snapshot. It cannot
   create availability for an activity with only past/no sessions. For self-paced
   or active participation an explicit date must equal the snapshot day.
8. This is the existing demo's future-session simulation, not evidence that a real
   future course has been attended. Historical imports remain a separate trusted
   HR flow; do not run interactive completion eligibility over past import rows.

## Backend integration sequence

1. Confirm the above policy in issue #7, especially assigned mandatory completion
   and continuation timing. Keep authorization, Origin/CSRF and existing envelopes.
2. Inside `completeActivity`'s existing `.immediate()` transaction, load the current
   dataset, normalize it, call the guard, and reject **before** inserting history.
   Do not decide on a stale preview from a previous request. No network work in
   this transaction.
3. Preserve 404 for missing references and 409 for non-repeatable duplicates.
   Use 422 `ACTIVITY_NOT_ELIGIBLE` for other refusals. Without extending the error
   DTO, reasons can be mapped to `details: [{ field: "completion.<code>", message }]`.
   Include each missing skill/current/required value in prerequisite messages.
4. Use `decision.completedAt`, not the unchecked request date, for the appended
   completion. `continuingRecordId` identifies the persisted assignment/participation
   if its source needs preserving. Do not mutate assessed employee skills.
5. Rebuild the view after the write as today. A rejection must not add history or
   an `activity.completed` audit record. Tests must use fresh temporary databases.
6. Run the existing failing HTTP regression unchanged until it passes. Add route
   tests for audience, unavailable events with forged dates, assigned mandatory,
   active participation, duplicate requests and unchanged failure counts.
7. Only then extend the API DTO, if desired, with per-event previews from the pure
   function. Revalidate at completion time; a preview is not an authorization token.
8. Run the full test/typecheck/lint/build gate before merge; do not skip the new
   regression to obtain a green result. Retain the existing auth/privacy tests.

The current recommender excludes any historical `in_progress` record. In a later
continuation UI, explicitly settle how a completed EV_036 participation closes an
old active record; otherwise that old record can keep the repeat out of new
recommendations. This PR intentionally does not silently change ranking/lifecycle
rules or overwrite imported history. Likewise, repeated HTTP requests for EV_036
remain a Backend idempotency decision, separate from the domain repeat exception.

## Frontend handoff after the API contract exists

- Show `preview.progress.before -> after` and `delta` as a forecast, not confirmed
  progress. `preview.effectiveSkills` and `skillGaps` are the simulated AFTER state.
- Use `expectedChanges` for per-skill before/after/requirement/critical evidence.
- Evaluate all alternatives against the same current dataset. Do not sum three
  independent deltas or label the cards as an already calculated sequential plan.
- Keep the existing displayed profile unchanged until completion succeeds; then
  replace it with the server's recomputed view and refetch AI explanations.
- On refusal display the server reasons. Do not grant access by hiding a disabled
  button only, and do not calculate eligibility or readiness in the client.

## Preview arithmetic

The preview checks completion, creates a virtual completed history record in a
detached dataset, then calls the existing `getEmployeeView`. That reuses assessment
cutoff rules, chronological history replay, teaching caps and weighted readiness.
It does not merely add gains to final effective skills: inserting a completion
before an already simulated future activity can produce a different result.

A completion already covered by `last_review_date` correctly has zero new effect.
A capped skill never decreases; a Lead without a target can gain skills while
readiness stays 0. Recommendation selection and LLM explanation contracts remain
unchanged. Readiness is not a promotion decision.

## Verification on this branch

Commands actually executed (no new paid OpenAI calls):

| Check | Result |
| --- | --- |
| `npm test -- tests/completion-policy.test.ts tests/completion-official.test.ts` | 42 passed |
| Official-data verbose sweep | 200 profiles, 173 with recommendations, 438 independent previews verified |
| Authenticated valid completion vs preview | E0178 / EV_005: API and preview match, 71.3 -> 74.1, API Design stays 4 |
| `npm test` | **272 passed, 1 failed, 2 live skipped**; failure is the unresolved raw HTTP bypass |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed (repository's frontend scope) |
| ESLint on the six new TypeScript files | Passed, zero warnings |
| `npm run build` | Passed, all existing routes built |
| `git diff --check` | Passed |

Full test output: [npm-test.txt](evidence/completion-policy-2026-09-23/npm-test.txt).
Synthetic tests additionally cover unknown IDs, missing skills, cross-role goals,
out-of-top-three completion, no-target completion, post-review history, cap
preservation, date spoofing, stale/foreign assignments, repeated EV_036, future
history order, independent alternatives and immutable inputs. Existing AI tests
also ran in the full suite; IDs/order/scores/effects remain deterministic.

The deliberate red gate is a release blocker, not a successful end-to-end fix.
After Backend integration, update this status and rerun tests from the final SHA.

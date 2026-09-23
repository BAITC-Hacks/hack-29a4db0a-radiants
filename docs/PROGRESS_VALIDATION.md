# Completion progress validation

Validated on the supplied Career Quest dataset using the fixed availability date `2026-10-01`.

## Method

Normalize 200 employees, 40 events, 60 skills, 32 role profiles, and 2,743 history records. Convert CSV numeric cells to numbers and empty optional cells to null. For each employee, build `EmployeeView`. Independently simulate completion of that employee's first recommendation by appending a completed history record (at its next session, or the snapshot date for self-paced activities), then rebuild the view.

Assert that every existing skill is nondecreasing, every previewed skill level matches the reconstructed result, and readiness increases when the recommendation reduces a target gap. Validate recommendations both before and after completion against mandatory status, audience, prerequisites, sessions, completed-event exclusion, and in-progress exclusion.

This exercises the pure engine's completion flow. It does not verify persistence, API endpoints, browser updates, or a live OpenAI request.

## Results

| Check | Result |
| --- | ---: |
| Employees checked | 200 |
| Employees with an active target | 190 |
| Employees with a first recommendation | 173 |
| Completions increasing readiness | 173 |
| Completions leaving readiness unchanged | 0 |
| Completions decreasing readiness | 0 |
| Skill decreases | 0 |
| Recommendations validated before/after completion | 787 |

For `E0178`, completing `EV_005` changes System Design from 1 to 2 while API Design stays at 4 despite the event's cap of 3. Readiness increases from 71.3 to 74.1.

For `E0058`, completing `EV_012` changes Python from 2 to 3 and readiness from 53.9 to 57.8.

The current complete-data regression is checked in at `tests/recommendation-quality.test.ts`; run `npm test -- tests/recommendation-quality.test.ts --reporter=verbose --silent=false`. It independently checks eligibility before and after every first completion, preview/result equality, strictly increasing readiness and nondecreasing skills. The count above reflects topic-aware history ranking; the earlier broad type/format heuristic produced 788 checked recommendations.

Small regressions also cover partial progress, caps, zero requirements, critical-gap priority, actual history counts after penalty saturation, weak unrelated-format signals, and reduced weight for externally assigned declines. Importable fixtures and their expected behavior are documented in `docs/JURY_DEMO.md`.

## Additional-profile regression checks

`tests/imported-profiles.test.ts` adds four checks using synthetic IDs outside the starter dataset: cross-role career goals and audience pairs; unordered history with review-date and employee boundaries; employee/HR consistency across successive completions; and participation counts for all six statuses. The original 21-test report is superseded by the current 142 passing offline tests; two live checks are skipped in that run.

In the imported-profile scenario, a missing SQL skill starts at 0. Completing its activity raises readiness from 22.2 to 55.6, removes SQL from HR gaps, and unlocks the Python recommendation through its prerequisite. Completing Python reaches 100. Lead-without-goal and blocked-employee states remain distinguishable. These tests begin with typed arrays; `tests/backend.test.ts` separately covers the persisted import API and rollback. Browser acceptance is recorded in `docs/RELEASE_CHECKLIST.md`.

## Integration handoff

- Backend: the persisted dataset, completion and import integration is now in main via PR #8. Preserve append-only completion history and shared engine ownership.
- Frontend: readiness can now contain one decimal place. Show the returned change and skill `before`/`after` values. Handle `needs_career_goal` explicitly.
- Joint verification: once API/UI are connected, run profile -> recommendation -> completion -> refreshed skills/readiness and import an extra profile. The live explanation check also needs a server-side `OPENAI_API_KEY`.

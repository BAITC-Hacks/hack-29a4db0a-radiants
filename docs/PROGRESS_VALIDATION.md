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
| Recommendations validated before/after completion | 788 |

For `E0178`, completing `EV_005` changes System Design from 1 to 2 while API Design stays at 4 despite the event's cap of 3. Readiness increases from 71.3 to 74.1.

For `E0058`, completing `EV_012` changes Python from 2 to 3 and readiness from 53.9 to 57.8.

Automated regression checks: `npm test` passes 17 tests, including a small synthetic reproduction of the above-cap bug, partial progress, caps from below, zero requirements, and critical-gap prioritization with repeated missed activities. `npm run typecheck` passes.

## Additional-profile regression checks

`tests/imported-profiles.test.ts` adds four checks using synthetic IDs outside the starter dataset: cross-role career goals and audience pairs; unordered history with review-date and employee boundaries; employee/HR consistency across successive completions; and participation counts for all six statuses. The full suite now passes 21 tests and TypeScript validation.

In the imported-profile scenario, a missing SQL skill starts at 0. Completing its activity raises readiness from 22.2 to 55.6, removes SQL from HR gaps, and unlocks the Python recommendation through its prerequisite. Completing Python reaches 100. Lead-without-goal and blocked-employee states remain distinguishable. These tests begin with typed arrays; file parsing and the import API still require Backend integration tests.

## Integration handoff

- Backend: load `CareerDataset`, append completed history without also increasing assessed skills, and rebuild employee/HR views. Preserve `src/types/career.ts` and the test scripts when adding the application scaffold.
- Frontend: readiness can now contain one decimal place. Show the returned change and skill `before`/`after` values. Handle `needs_career_goal` explicitly.
- Joint verification: once API/UI are connected, run profile -> recommendation -> completion -> refreshed skills/readiness and import an extra profile. The live explanation check also needs a server-side `OPENAI_API_KEY`.

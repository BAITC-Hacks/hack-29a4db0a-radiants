# Frontend integration handoff

Reviewed `feat/career-quest-frontend` at `632556b` against the engine merged into `main` through PR #1. This is a review of that revision, not a claim that later frontend or backend work has the same gaps.

## Findings and owners

### P1: Official starter files cannot initialize the current UI

`src/lib/frontend/dataset.ts:67` accepts JSON only if it contains employees or history. The official `events.json` and `skills.json` wrappers are rejected. Importing the official `employees.json` into a fresh demo fails because its target role profiles are not in the demo catalog. Reproduced in the browser: the error identifies missing Customer Support Specialist Lead requirements.

Backend: load all four official files into `CareerDataset`. Map `employees.json.employees`, `events.json.events`, `skills.json.skills`, and `skills.json.role_profiles` to the corresponding arrays; parse CSV numeric values and nullable fields. Initialize the complete catalog before importing extra jury profiles/history.

Frontend: wire import to the agreed backend importer, or support starter wrappers in the browser adapter until the server exists. Employee-only imports should extend a fully loaded official catalog.

### P1: Real AI is not connected to the user flow

`src/components/App.tsx:16` calls synchronous `getEmployeeView` directly in the browser. `RecommendationCard` at line 87 renders reasons and history only; neither `aiExplanation` nor `deterministicExplanation` is rendered. The server-side explainer exists but has no request path from the UI. A backend-only AI change will therefore not expose the explanation in the demo.

Backend: call `getEmployeeViewWithAi` with a server-side `OPENAI_API_KEY` from the recommendation endpoint. Keep fallback responses available when the key or model is unavailable. Do not move this key into a `VITE_*` variable or client code.

Frontend: request the server recommendation view, show `aiExplanation ?? deterministicExplanation` alongside evidence, and handle loading, failure, and a changed employee selection. Preserve `explanationSource` so an AI failure is represented accurately.

### P2: Full dataset import leaves demo catalog entries behind

`src/lib/frontend/dataset.ts:72` recognizes a full dataset, but lines 76-78 still merge events, skills, and role profiles. Importing the official catalog yields 200 employees and 2,743 history records, but **45 events and 63 skills**, rather than 40 and 60. This contradicts the README's replacement semantics. Retained demo activities can become candidates for later imported profiles using those demo skill IDs.

Frontend/import owner: when importing a full dataset, replace all five arrays. Use ID-based merge only for a partial import. Add a regression assertion for exact catalog IDs and lengths after replacement.

### P2: HR lists hide most loaded records

`src/components/App.tsx:97-99` truncates skills, employees, and events to 6/6/7 rows without pagination or an expansion control. With the official dataset, the metric reports 27 employees without recommendations but only 6 are accessible in the list; only 7 of 40 participating activities are displayed.

Frontend: add pagination, expansion, or complete scrollable lists. Make the full set accessible during jury evaluation.

## Verified behavior

- Shared `src/types/career.ts`, recommendation, data, AI, and HR modules match `main`; no contract drift was found.
- Frontend branch: all 23 existing tests, production build (including TypeScript), and lint pass. `npm ci` succeeds.
- Browser demo: Amina's completion changes readiness from 87.5 to 100, updates HR, and survives a reload. No page exceptions occurred during that completion flow.
- Read-only probes reproduce rejection of all three raw JSON starter files in the fresh demo and retention of demo catalog entries in full import.
- After converting the official wrappers into a combined `CareerDataset` JSON and importing the original CSV, all 200 profiles run through the engine. 173 have recommendations and 27 have none.
- Browser with official data: selecting `E0178` and completing the top recommendation changes readiness from 71.3 to 74.1. HR then shows 200 employees and 2,744 history records, including the new completion.
- This verifies the browser/local-storage path. No server endpoint, server persistence, authentication, or live OpenAI request was tested because those integrations are absent from the reviewed revision.

## Next integration sequence

1. Backend publishes the official dataset loader and server entry point. The frontend already uses React/Vite; coordinate the server/proxy approach before introducing another app scaffold.
2. Connect employee listing/detail, recommendation, completion, import, and HR endpoints using the existing engine contracts. On completion append history, then rebuild views; do not also modify assessed skills.
3. Frontend renders the returned explanation and progress delta, fixes full-replacement imports, and makes complete HR lists accessible.
4. Run the joint scenario on an official employee, then import an extra profile and history. Verify completion, refresh persistence, HR consistency, live AI explanation, and fallback after an AI failure.

AI/Data next step: supply a pure adapter for official JSON wrappers and already-parsed CSV rows so Backend can reuse the schema mapping without moving file I/O into the engine.

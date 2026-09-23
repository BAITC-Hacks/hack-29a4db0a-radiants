# Frontend async integration validation

Date: 2026-09-23. Base includes main `06b46ad`. No backend/domain behavior changed by this frontend implementation.

## Automated checks

- TypeScript: PASS.
- ESLint: PASS, including hooks and all frontend test files.
- Vitest: 151 passed; 2 live-AI tests skipped because this verification run has no provider credentials.
- Next.js production build: PASS.

React DOM tests mount the real App in jsdom, use deferred API promises that deliberately ignore abort, and verify:

- Fast profile and deterministic explanations render before the separate recommendation promise resolves.
- B resolves before A; only B is displayed. Rapid three-employee switching and returning to the same employee also rejects the older generation.
- Completion aborts before the API mutation starts. The profile stays visible, old cards disappear, the committed profile/history replaces the old version, and a new request starts. Late old answers cannot overwrite it.
- Already displayed AI text disappears immediately on mutation and cannot flash on the new profile.
- Import aborts before upload; the imported employee is fetched and its recommendations remain current even if the old answer arrives last.
- AI failure retains deterministic cards and profile; recommendation retry does not reload the profile.
- Unmount aborts and ignores late answers.

Additional tests cover the actual GET recommendation route, extraction of recommendation fields only, employee identity checking, null AI normalization, late fetch responses after abort, all six history statuses, newest-first ordering, unmodified input, missing/empty history, 180 accessible rows, deduplication, current-employee filtering, untargeted skills with/without a career goal, whitespace/null/empty AI fallback and truthful source labels.

## Browser checks

Used the production Next.js build, actual SQLite API and official synthetic dataset, with a separate scratch database outside the repository. No live AI key was used.

- Profile, effective skills, catalog names, deterministic explanation source and available activity history render.
- E0043 completion changes readiness from 63.2% to 65.2%. Public Speaking Club appears first in history with Completed, date 2026-10-08, 100%, Self, 2 h. Dates and progression are supplied by the backend.
- JSON multipart import creates a synthetic Lead profile without a career goal and automatically selects it. All 23 supplied effective skills remain visible with their current levels. No target requirements are fabricated. Empty history is explicit.
- At 390px viewport there is no document-level horizontal overflow; the 690px history table scrolls within its container.
- No browser warning/error logs were captured during completion and import.

## Limits / handoff

- The current API omits noncompleted voluntary history. UI displays all records it receives and states the available scope. A full history array/endpoint is a backend follow-up.
- The server AI endpoint is integrated from main; real provider calls were not rerun in this frontend verification. AI display and race behavior are covered with controlled responses; backend runtime/provider regression tests also pass.
- Local revisions protect this browser's transitions. Server revisions would be needed to detect another client's concurrent changes.
- Windows verification used `npm ci --ignore-scripts`: better-sqlite3 already ships a working Windows prebuilt binary, while default npm installation attempted a C++ rebuild without an installed toolchain. SQLite backend tests and browser mutations passed using that binary.

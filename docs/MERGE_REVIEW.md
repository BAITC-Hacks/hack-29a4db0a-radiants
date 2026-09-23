# Integration review — 2026-09-23

Reviewed remote main at `1bef61f` and PRs #1–6 and #8. PR #7 was not available in this repository.

| PR | Decision |
| --- | --- |
| #1 | Already merged; shared types and deterministic engine retained. |
| #2 | Already merged; imported-profile and HR regression tests retained. |
| #3 | Included as its original commit in #8; historical frontend findings remain labeled as such. |
| #4 | Already merged; backend loads official files through the adapter. |
| #5 | Included in #8 after preserving Next.js scripts/dependencies and changing the moved fixture import to tests/fixtures/career-dataset. Production routes remain deterministic. |
| #6 | Hold for integration changes described below. |
| #8 | Combined frontend, SQLite, API and Docker integration; verification recorded below and in BACKEND_VALIDATION.md. |

## PR #6 blockers

- `vite.config.ts` installs `POST /api/recommendations` only in Vite dev/preview middleware. The production application starts Next.js, so that handler is not registered there.
- `src/hooks/use-ai-recommendations.ts` and its App changes depend on a browser-side `CareerDataset`. The current frontend retrieves compact employee cards and server-owned views; completions/imports persist in SQLite.
- Its live/API tests import `src/lib/frontend/demo-data`, which has moved to `tests/fixtures/career-dataset` in the integrated frontend.
- Restoring the old App/dataset flow during conflict resolution would lose the current persistent API flow. The AI text enrichment needs to consume the server-reconstructed EmployeeView and preserve the existing API envelopes and completion response.

НАПАРНИК/И — Domain/AI and Backend: update #6 from the merged main and port optional explanation enrichment to the Next.js service. Keep ranking, skills and eligibility deterministic; reuse #5 fallback/deadline behavior. A live OpenAI check remains a separate step requiring a server key. No live API request was made during this merge review.

## Verification

- Offline suite: 115 passed, 1 live test skipped. No OpenAI requests.
- TypeScript and frontend lint: passed.
- Docker production build: passed, including Next.js compile and type check.
- `docker compose up -d --wait`: healthy after recreating the container.
- Runtime health: 60 skills, 32 role profiles, 200 employees, 40 events, 2,745 history records (the official seed plus two earlier demo completions).
- E0178 readiness remains 74.1 after container recreation and browser reload. HR reports population 200 and completion rate 79.4. Browser warning/error logs are empty.
- Shared types, adapter, recommendation arithmetic and HR engine have no diff from the reviewed main.

During the final fetch, frontend branch advanced to `b1f341a` with visual changes. No PR for that revision was listed; this merge retains the already integrated and tested frontend at `92dd0fd`. The newer visual changes remain on their branch for a separate PR.

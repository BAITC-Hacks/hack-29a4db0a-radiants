# Career Quest

Career Quest makes employee development steps visible and explainable. The repository contains a deterministic TypeScript recommendation/HR engine and a React/Vite demo frontend.

## Run locally

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Other useful commands:

```sh
npm test                # Vitest suite
npm run typecheck       # Strict TypeScript check
npm run lint            # ESLint for the frontend and import adapter
npm run build           # Production Vite bundle
npm run preview         # Serve the production bundle locally
```

## Current app and data boundary

- The active branch has no server, API routes, or authentication layer. The frontend calls the repository's `getEmployeeView` recommendation engine and `buildHrSummary` directly; the suggested `/api/*` endpoints are not present in this repository revision.
- When no imported data is saved, the app loads a small **synthetic demo dataset** from `src/lib/frontend/demo-data.ts`. It is clearly marked as a demo workspace and does not pretend to be the case dataset.
- Imports and activity completion are kept in this browser's local storage. Clear the site's storage to reset the demo state.
- The HR navigation is a product-level view switch, not an authorization boundary. Add server-side identity and access control before using non-synthetic employee data.
- No API key is needed. The existing AI explainer is a server-side optional module; this static frontend uses the engine's deterministic, evidence-derived explanation and does not expose API credentials in the browser.

## Import data

Use **Import data** to add `employees.json`, `activity_history.csv`, or a complete JSON dataset. JSON accepts an employee array, a history array, or an object such as:

```json
{
  "employees": [],
  "history": [],
  "events": [],
  "skills": [],
  "roleProfiles": []
}
```

`events`, `skills`, and `roleProfiles` are optional when extending the demo catalog and are merged by their IDs. A complete dataset containing all five arrays replaces the demo data. The employee and event objects must follow `src/types/career.ts`; an employee's target role/grade needs a matching role profile. CSV accepts the `activity_history.csv` columns from the team contract, or employee rows with `employee_id`, `full_name`, `role`, and `grade`; nested `skills` and `career_goal` columns are JSON text. Malformed files and missing role requirements are reported in the dialog.

The recommendation engine uses the fixed snapshot date **2026-10-01**, reconstructs effective skills from post-review completions, excludes mandatory/ineligible events, simulates skill effects, and cites target requirements and relevant participation history.

## Demo path

1. Open Amina Sadykova (Backend Engineer, Middle → Senior) or select another profile.
2. Review the readiness snapshot, target skill levels, and ranked activity evidence.
3. Complete “Designing high-load systems”; its System design level and readiness recalculate without a reload, and the activity leaves the recommendation list.
4. Import employee/history or a full dataset to extend the profiles.
5. Open **HR overview** for common competency gaps, employees without an eligible next step, and activity participation.

## Repository structure

- `src/types/career.ts` — shared domain contract.
- `src/lib/recommendation/` — deterministic eligibility, skill reconstruction, ranking, and explanations.
- `src/lib/analytics/` — HR summary aggregation.
- `src/lib/ai/` — optional validated server-side explanation adapter.
- `src/components/`, `src/styles/`, `src/lib/frontend/` — demo UI and browser-only adapter.
- `tests/` — engine, HR, AI validation, and frontend import tests.

The official case context and detailed behavior rules are in [HACKATHON_CONTEXT.md](HACKATHON_CONTEXT.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

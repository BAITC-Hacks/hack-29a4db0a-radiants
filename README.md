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

### Official dataset adapter for Backend

`adaptStarterDataset` in `src/lib/data/starter-dataset.ts` converts decoded official JSON wrappers and already-parsed CSV rows into a validated `CareerDataset`. It performs no file I/O and does not merge demo entries. See [the adapter handoff](docs/STARTER_DATASET_ADAPTER.md) for the input contract, validation rules, and full-dataset results. The browser import dialog still needs to be wired to this adapter or a server importer.

```ts
import { adaptStarterDataset } from "./src/lib/data/starter-dataset";
import { normalizeDataset } from "./src/lib/data/normalize";

const data = adaptStarterDataset({
  employeesFile, // JSON.parse(employees.json text)
  eventsFile,    // JSON.parse(events.json text)
  skillsFile,    // JSON.parse(skills.json text), including role_profiles
  historyRows,   // objects returned by a CSV parser with headers
});
const normalized = normalizeDataset(data);
```

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

## AI/Data module

The recommendation engine is a pure TypeScript module. It accepts normalized arrays and does not read files or depend on the web framework.

```ts
import { normalizeDataset } from "./src/lib/data/normalize";
import { getEmployeeView } from "./src/lib/recommendation";

const dataset = normalizeDataset({ employees, events, skills, roleProfiles, history });
const employeeView = getEmployeeView(dataset, employeeId);
```

`EmployeeView`, `Recommendation`, `SkillGap`, and source domain types are in `src/types/career.ts`. The integration layer should normalize JSON/CSV into `CareerDataset` and call `getEmployeeView`. The engine owns eligibility, effective skills, target gaps, deterministic ranking, and evidence.

Use `getEmployeeViewWithAi(dataset, employeeId, createOpenAIExplainer({ apiKey }))` to compose deterministic ranking and AI explanations on the server. The explainer calls the OpenAI Responses API with Structured Outputs, may describe only supplied recommendation evidence, and leaves the deterministic explanation in place if the request fails or evidence references do not validate. Set `OPENAI_API_KEY` in the server environment; never expose it to browser code.

Recommendation score is deterministic: 40 points per critical target-gap level closed, 10 per other target-gap level closed, up to -30 for recent no-shows/drops/declines on events with the same type and format, and +/-5 for strong/low feedback on those events. Ties use critical gap impact, next session date, then event ID. AI evidence references are limited to `target`, `history`, `availability`, and the recommendation's `skill:<skillId>` changes.

HR aggregates are available through `buildHrSummary(normalizedDataset)` from `src/lib/analytics/hr-summary.ts`.

## Completion and progress contract

Use the fixed dataset date `2026-10-01` for availability. Start effective skills from the employee assessment, with missing skills equal to 0, then apply completed activities after `last_review_date` in date order. History reconstruction and recommendation previews share the same rule:

```text
after = max(before, min(before + gain, max_level))
```

An activity never lowers an attained skill: `before=4, gain=1, max_level=3` stays at 4. Gains from below still stop at the activity cap. Skill levels remain integers from 0 to 5.

`readiness` measures partial fulfillment of target requirements. Each required skill contributes `min(currentLevel / requiredLevel, 1)`, weighted 2 for critical skills and 1 otherwise. Divide the weighted sum by total weight, multiply by 100, and round to one decimal. A zero-level requirement is fully satisfied; an empty requirements list yields 100. A Lead without a career goal keeps `targetStatus: "needs_career_goal"` and readiness 0. This is a development indicator, not a promotion decision.

Backend: append a completed history record and rebuild `EmployeeView` from the updated dataset. Do not also mutate assessed skills, which would count the gain twice. Frontend: display the returned readiness (which may be decimal), its change, and recommendation `expectedChanges`; do not recalculate business rules. The `EmployeeView` shape is unchanged.

Run the AI/Data checks with `npm test` and `npm run typecheck`.

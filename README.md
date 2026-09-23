# Career Quest

Career Quest makes employee development steps visible and explainable. The repository contains a deterministic TypeScript recommendation/HR engine and a React/Vite API-driven frontend.

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
npm run lint            # ESLint for frontend components, hooks and adapter
npm run build           # Production Vite bundle
npm run preview         # Serve the production bundle locally
```

## Frontend and API boundary

The React/Vite frontend is presentation-only. It requests shared `EmployeeView` and `HrSummary` shapes through `src/lib/frontend/api.ts`; it does not run the recommendation engine, parse imports, aggregate HR metrics or persist employee data in the browser.

**HTTP routes are not yet implemented in this repository revision.** The complete proposed endpoint contract, response shapes, backend responsibilities and remaining fields are in [docs/FRONTEND_API.md](docs/FRONTEND_API.md). Without a backend the UI displays a recoverable error, not synthetic demo data.

For local backend integration, copy `.env.example` to `.env.local` and set `CAREER_API_TARGET` to the server origin. Run `npm run dev`; Vite forwards `/api` to that origin. Production needs the same-origin API or a public `VITE_API_BASE_URL` configured at build time. Never put `OPENAI_API_KEY` in a `VITE_*` variable.

## Import and completion

**Import data** uploads the original JSON/CSV file as multipart field `file`. Backend owns parsing, normalization, validation and persistence. The dialog displays backend messages, refreshes employees and selects an affected/new profile. If upload succeeds but refresh fails, retry refresh does not resend the file.

Completing an activity sends its IDs to the API and displays the returned employee view (or refetches after a success-only response). The success panel compares backend-computed readiness and effective skills before/after. It does not predict actual completion results from event gains. Uncertain mutation failures require profile reload before retrying.

## Demo flow with a connected backend

1. Select an employee and inspect returned readiness, target requirements and expected skill changes.
2. Read all recommendation reasons; an optional nonempty AI explanation appears below them.
3. Complete an activity and inspect actual readiness/skill changes from the refreshed profile.
4. Open an employee with no recommendations to see the explicit no-next-step state.
5. Upload an additional profile/history file and open the refreshed imported employee.
6. Open **HR overview** for supplied competency counts, every no-step employee and participation status counts. Missing aggregate metrics remain hidden.

The synthetic fixture lives only in `tests/fixtures/career-dataset.ts`. Browser verification with a fixture API is not verification of backend persistence or official dataset import.

## Repository structure

- `src/types/career.ts` — shared domain contract.
- `src/lib/recommendation/` — deterministic eligibility, skill reconstruction, ranking and explanations.
- `src/lib/analytics/` — HR summary aggregation.
- `src/lib/ai/` — optional validated server-side explanation adapter.
- `src/components/`, `src/hooks/`, `src/styles/` — presentation and request state.
- `src/lib/frontend/` — typed HTTP adapter and response shape guards.
- `tests/` — unchanged PR #1 engine/HR/AI tests plus frontend transport/render tests.

The official context and behavior rules are in [HACKATHON_CONTEXT.md](HACKATHON_CONTEXT.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

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

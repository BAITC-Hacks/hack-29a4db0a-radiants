# hack-29a4db0a-radiants
Hackathon team repository for Radiants

## AI/Data module

The recommendation engine is a pure TypeScript module. It accepts normalized arrays and does not read files or depend on the web framework.

```ts
import { normalizeDataset } from "./src/lib/data/normalize";
import { getEmployeeView } from "./src/lib/recommendation";

const dataset = normalizeDataset({ employees, events, skills, roleProfiles, history });
const employeeView = getEmployeeView(dataset, employeeId);
```

`EmployeeView`, `Recommendation`, `SkillGap`, and source domain types are in `src/types/career.ts`. The file/API integration layer should normalize JSON/CSV into `CareerDataset` and call `getEmployeeView`; the recommendation engine owns eligibility, effective skills, target gaps, deterministic ranking, and evidence.

Use `getEmployeeViewWithAi(dataset, employeeId, createOpenAIExplainer({ apiKey }))` to compose deterministic ranking and AI explanations. The explainer calls the OpenAI Responses API with Structured Outputs, may only describe supplied recommendation evidence, and leaves the deterministic explanation in place if the request fails or its evidence references do not validate. Set `OPENAI_API_KEY` in the server environment; never expose it to browser code.

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

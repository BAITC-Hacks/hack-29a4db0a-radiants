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

Run the AI/Data checks with `npm test` and `npm run typecheck`.

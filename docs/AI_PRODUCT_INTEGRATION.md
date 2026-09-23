# AI in the product

## Implemented path

Employee selection or dataset change -> `useAiRecommendations` -> same-origin `POST /api/recommendations` -> validated `CareerDataset` -> deterministic ranking -> OpenAI Responses API -> schema/evidence validation -> visible explanation in the recommendation card.

The Node handler is mounted through Vite's `configureServer` and `configurePreviewServer` hooks. `npm run dev` starts the UI and API together; `npm run build` followed by `npm run preview` serves the built UI with the same API. Both bind to loopback by default. The [Vite plugin API](https://vite.dev/guide/api-plugin.html#configureserver) documents these middleware hooks. This is a local hackathon server, not a static-only deployment or a production identity/storage system.

The hook sends one selected employee and that employee's history, plus the event/skill/role catalog. The server validates the input using `adaptStarterDataset` and recomputes recommendations before sending evidence to OpenAI. The model cannot introduce an event or replace scoring/skill arithmetic. The full employee profile, history, and API key are not included in the model prompt.

The UI renders `aiExplanation ?? deterministicExplanation`. It labels each card `AI EXPLANATION` or `RULE-BASED EXPLANATION`, reports loading/configuration/failure states, and provides retry. Changing employees or completing/importing an activity cancels obsolete UI requests and immediately displays current deterministic progress while a new explanation loads.

## API contract

Request: `POST /api/recommendations`, `Content-Type: application/json`, body `{ employeeId: string, dataset: CareerDataset }`. The browser supplies a selected-employee subset; valid complete datasets are also accepted. The request limit is 2 MB.

Success response: `{ view: EmployeeView, aiStatus }`. Status values:

| aiStatus | Meaning |
| --- | --- |
| `llm` | Every returned recommendation has validated model text |
| `partial` | Some recommendations have validated text; others retain fallback |
| `unavailable` | Model request or validation failed; deterministic view is returned |
| `not_configured` | Server key is missing; no model request was made |
| `not_needed` | No recommendations need explanation; no model request was made |

Invalid JSON/data returns 400; an unknown employee returns 404; wrong method 405; oversized body 413; wrong content type 415. Responses disable caching. The server's default AI deadline is 8 seconds, and the browser aborts after 9.5 seconds. Neither HTTP error bodies nor keys are shown to end users.

## Configuration and team handoff

Set `OPENAI_API_KEY` on the server or in ignored `.env.local`, and optionally `OPENAI_MODEL`. Restart the dev/preview server after credential changes. Do not use `VITE_OPENAI_API_KEY`. `npm run test:ai-live` checks the real adapter independently; then verify the product card and the actual `/api/recommendations` response have `explanationSource: "llm"`.

Backend can move `createRecommendationsHandler` to a persistent server later. Preserve response status semantics and recompute business logic before AI. Replace client-provided demo data with trusted storage/authenticated employee identity when implementing the production data boundary.

Frontend should retain the cancellation logic, immediate progress updates, explanation text, source labels, and retry control. Local storage remains the demo's source of persistent state. The official starter-file importer and complete HR lists remain separate work from this AI integration.

## Verification and limits

- HTTP integration tests run a real local Node server, inject a test OpenAI transport, and verify actual routing, validated model text, missing-key status, timeout fallback, updated history, invalid requests, and body limits.
- Browser checks confirm the real endpoint is requested when selecting employees and reports missing-key fallback correctly.
- The built preview also serves the endpoint and renders the same missing-key state. At 1366px and 390px widths, the page has no horizontal overflow; explanation/status text was visually checked in screenshots.
- With an explicitly labeled browser test double, AI text rendered correctly, a delayed response for the previous employee was ignored, and completing an activity raised readiness from 70.8 to 87.5 and sent a fresh request with updated history. These are integration checks, not proof of a live model call.
- Successful live OpenAI output remains unverified until the team configures the server key. A missing-key response must not be counted as fulfillment of the AI demo requirement.

The integrated suite passes 76 tests with one opt-in live test skipped. TypeScript, production build, and lint pass. Client build inspection found no server API-key variable, OpenAI endpoint URL, or bearer-authorization code in `dist/`. Vite emits a forward-looking warning about extensionless imports with a future native config loader; the current bundled config loader works in dev, tests, build, and preview.

This integration includes the adapter and reliability changes from PRs #4 and #5. Those changes do not have to be merged separately before this branch; the integration PR contains the complete code path.

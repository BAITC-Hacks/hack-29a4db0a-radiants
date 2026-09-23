# AI reliability and Backend handoff

## Server integration

Keep `createOpenAIExplainer` and its key on the server. Construct it with `{ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL }`, then call `getEmployeeViewWithAi(dataset, employeeId, explainer)`. The caller must handle an unknown employee or invalid dataset separately; the AI fallback covers explanation failures, not domain errors.

The existing default model is unchanged (`gpt-6-astra`). Model availability depends on the team's API project. The optional `model` argument allows Backend to select an available Structured Outputs model without editing the engine.

The adapter requires a completed Responses API response and rejects refusals before parsing text. Its schema requires an object containing `recommendations`, with `eventId`, `explanation`, and `evidenceRefs` per item. Extra fields are rejected. At least three distinct, permitted evidence references are required by the business validator; invented event IDs or skill references cannot change the deterministic result. This validates structure and references, not the truth of every sentence of natural-language output; review the live explanation during the demo rehearsal.

The system prompt asks for short explanations grounded in target, history, and skill evidence. Supplied titles and evidence are treated as data rather than instructions. The model receives the target and already-ranked recommendation evidence, not the employee's full profile or the API key.

## Deadline and fallback

- Default deadline: 8,000 ms for the request and response body combined, before returning deterministic fallback through `getEmployeeViewWithAi`.
- Timeout rejects the pending explanation and aborts the HTTP request. A custom transport that ignores cancellation cannot delay fallback or overwrite it with a late answer.
- Missing/blank keys fail before network access. Empty recommendation lists bypass AI entirely.
- HTTP errors (including 401, 429, and 500), refusal, non-completed status, invalid JSON/schema, and insufficient or unknown evidence preserve fallback. There are no automatic retries.
- Successfully validated explanations add text and set `explanationSource` to `llm`; IDs, order, scores, skill changes, and readiness remain deterministic. A partially valid explanation list can enrich valid recommendations while leaving the others on fallback.
- Frontend should render `aiExplanation ?? deterministicExplanation`, retain evidence, and honor `explanationSource`.

## Real API check

1. Supply a valid server-side `OPENAI_API_KEY` in the environment or ignored `.env.local`. Never use a `VITE_*` key or commit credentials.
2. Optionally set `OPENAI_MODEL` to the model chosen for the demo.
3. Run `npm run test:ai-live`. It loads `.env.local` when present and performs one real request with synthetic recommendation evidence. It checks LLM output, unchanged deterministic fields, and elapsed time below 10 seconds. API usage is billed normally.
4. A missing key, API/model access error, timeout, or fallback fails the check rather than producing a misleading success. The test does not log keys, request headers, or complete API responses.

Ordinary `npm test` skips the live test, even if a key is available. Explicit execution can also be enabled with `RUN_OPENAI_SMOKE=1`. The live test runs in Node and uses Node environment-file support; Node 20.19+ or 22.12+ matches the existing app requirements. `@types/node` is a development-only dependency for typechecking this server test.

## Verification in this change

Regression tests first reproduced requests with an empty key, acceptance of incomplete/failed responses, refusal bypass, and failure to settle when an injected transport ignored abort. The updated tests cover valid REST output following a reasoning item, malformed envelopes, event/evidence substitution, status errors, HTTP failures, timeout during headers/body, timer cleanup, and late-response behavior.

The local environment has no `OPENAI_API_KEY` or `.env.local`. The explicit live command was run and correctly failed its preflight without sending a request. A successful real OpenAI response and the server/API/UI path remain unverified until Backend supplies the key and endpoint.

On the frontend-integrated base used by this branch, 47 tests pass and the one opt-in live test is skipped during `npm test`. Production build (including TypeScript) and lint checks pass. Other open PRs have additional tests and are independent of this change.

Official API behavior was checked against the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), including `text.format`, refusals, and incomplete responses.

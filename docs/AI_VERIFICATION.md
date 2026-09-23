# AI reliability and Backend handoff

## Server integration

`GET /api/employees/:id/recommendations` calls the persisted Next.js service. It reconstructs EmployeeDetail from SQLite and invokes `applyAiExplanations` with the server-only `createOpenAIExplainer`. Completed activities and all deterministic fields are preserved. Profile and completion routes stay fast and deterministic. The network request is outside the completion transaction. Unknown employee/domain errors still return normal API errors, not AI fallback.

The default model is `gpt-6-astra`, with explicit low reasoning effort, a 2000-token output cap and `store: false`. Coding-agent settings do not affect this request. Model availability depends on the team's API project; `OPENAI_MODEL` can override it. Other models are not sent an Astra-specific reasoning setting.

The adapter requires a completed Responses API response and rejects refusals before parsing text. Its schema requires an object containing `recommendations`, with `eventId`, `explanation`, and `evidenceRefs` per item. Extra fields, duplicate event explanations and text longer than 1000 characters are rejected. Evidence must include target, history and a skill whose target gap actually shrinks; availability cannot substitute for a gap. This validates structure and references, not the truth of every sentence of natural-language output. Review live text during rehearsal and always display deterministic evidence.

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
3. Run `npm run test:ai-live`. It loads `.env.local` when present and performs two real requests for official synthetic employees E0178 and E0058 in temporary SQLite databases. It checks LLM output, unchanged deterministic fields/history, and elapsed time below 10 seconds per call. API usage is billed normally.
4. A missing key, API/model access error, timeout, or fallback fails the check rather than producing a misleading success. The test prints only employee/event IDs, elapsed time and explanation text for human review, never keys, headers or complete provider responses.
5. For Docker, start with `docker compose --env-file .env.local up --build`. Verify AI in the browser, then start without a key and verify visible fallback. Restarting a container without recreating it does not update its environment.

Ordinary `npm test` skips the live test, even if a key is available. Explicit execution can also be enabled with `RUN_OPENAI_SMOKE=1`. The live test runs in Node and uses Node environment-file support; Node 20.19+ or 22.12+ matches the existing app requirements. `@types/node` is a development-only dependency for typechecking this server test.

## Verification in this change

Regression tests first reproduced requests with an empty key, acceptance of incomplete/failed responses, refusal bypass, and failure to settle when an injected transport ignored abort. The updated tests cover valid REST output following a reasoning item, malformed envelopes, event/evidence substitution, status errors, HTTP failures, timeout during headers/body, timer cleanup, and late-response behavior.

The current working environment has no key configured. Successful real OpenAI output remains an open acceptance gate, not a claim implied by mocked tests. Frontend must request the AI endpoint separately, retain deterministic data while it loads and cancel/discard stale responses after selection, completion or import.

The first persisted AI slice passes 125 tests; two real-call cases are skipped in the offline suite. TypeScript, frontend lint and the Next.js production build pass. Runtime tests use real temporary SQLite, official seed data and the actual recommendation route, with explicitly mocked OpenAI transport. They cover field/history preservation, fresh results after completion, missing key and provider failure.

Official API behavior was checked against the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), including `text.format`, refusals, and incomplete responses.

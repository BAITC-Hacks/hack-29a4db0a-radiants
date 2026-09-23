# AI reliability and Backend handoff

## Server integration

`GET /api/employees/:id/recommendations` calls the persisted Next.js service. It reconstructs EmployeeDetail from SQLite and invokes `applyAiExplanations` with the server-only `createOpenAIExplainer`. Completed activities and all deterministic fields are preserved. Profile and completion routes stay fast and deterministic. The network request is outside the completion transaction. Unknown employee/domain errors still return normal API errors, not AI fallback.

The default model is `gpt-6-astra`, with explicit low reasoning effort, a 2000-token output cap and `store: false`. Coding-agent settings do not affect this request. Model availability depends on the team's API project; `OPENAI_MODEL` can override it. Other models are not sent an Astra-specific reasoning setting.

The adapter requires a completed Responses API response and rejects refusals before parsing text. Its schema requires an object containing `recommendations`, with `eventId`, `explanation`, and `evidenceRefs` per item. Extra fields, duplicate event explanations and text longer than 1000 characters are rejected. Evidence must include target, history and a skill whose target gap actually shrinks; availability cannot substitute for a gap. This validates structure and references, not the truth of every sentence of natural-language output. Review live text during rehearsal and always display deterministic evidence.

The system prompt asks for short explanations grounded in target, history, and skill evidence. Supplied titles and evidence are treated as data rather than instructions. The model receives the target and already-ranked recommendation evidence, not the employee's full profile or the API key.

## Deadline and fallback

- Default deadline: 8,000 ms for the request and response body combined, before returning deterministic fallback through `getEmployeeViewWithAi`.
- The Next.js handler budgets 9,500 ms from entry. Profile reconstruction consumes that budget; the provider gets at most the smaller of 8,000 ms and the remaining budget. An independent service deadline also handles custom explainers that never settle. The 500 ms reserve targets serialization/transport overhead; unusually stalled event loops or network delivery cannot be hard-bounded by an application timer.
- Timeout rejects the pending explanation and aborts the HTTP request. A custom transport that ignores cancellation cannot delay fallback or overwrite it with a late answer.
- Missing/blank keys fail before network access. Empty recommendation lists bypass AI entirely.
- HTTP errors (including 401, 429, and 500), refusal, non-completed status, invalid JSON/schema, and insufficient or unknown evidence preserve fallback. There are no automatic retries.
- Successfully validated explanations add text and set `explanationSource` to `llm`; IDs, order, scores, skill changes, and readiness remain deterministic. A partially valid explanation list can enrich valid recommendations while leaving the others on fallback.
- Frontend should render `aiExplanation ?? deterministicExplanation`, retain evidence, and honor `explanationSource`.

## Real API check

1. Supply a valid server-side `OPENAI_API_KEY` in the environment or ignored `.env` / `.env.local`. Never use a `VITE_*` or `NEXT_PUBLIC_*` key or commit credentials.
2. Optionally set `OPENAI_MODEL` to the model chosen for the demo.
3. Run `npm run test:ai-live`. It loads `.env.local`, then `.env` without replacing existing environment values, and performs two real requests for official synthetic employees E0178 and E0058 in temporary SQLite databases. To run only one, use `npm run test:ai-live -- -t E0178`. It checks LLM output, unchanged deterministic fields/history, and elapsed time below 10 seconds per call. API usage is billed normally.
4. A missing key, API/model access error, timeout, or fallback fails the check rather than producing a misleading success. The test prints only employee/event IDs, elapsed time and explanation text for human review, never keys, headers or complete provider responses.
5. With `.env`, start with `docker compose up --build`; for `.env.local`, add `--env-file .env.local` before `up`. Verify the recommendations HTTP endpoint directly until the separate frontend fetch is connected. Restarting a container without recreating it does not update its environment.

Ordinary `npm test` skips the live test, even if a key is available. Explicit execution can also be enabled with `RUN_OPENAI_SMOKE=1`. The live test runs in Node and uses Node environment-file support; Node 20.19+ or 22.12+ matches the existing app requirements. `@types/node` is a development-only dependency for typechecking this server test.

## Verification in this change

Regression tests first reproduced requests with an empty key, acceptance of incomplete/failed responses, refusal bypass, and failure to settle when an injected transport ignored abort. The updated tests cover valid REST output following a reasoning item, malformed envelopes, event/evidence substitution, status errors, HTTP failures, timeout during headers/body, timer cleanup, and late-response behavior.

Live verification on 2026-09-23 passed using the user-provided server key. `npm run test:ai-live -- -t E0178` passed with actual LLM output and unchanged deterministic fields. The live E0058 case was not executed. A second real request through the rebuilt Docker HTTP endpoint returned three `llm` explanations in 7,026 ms; existing readiness remained 74.1 and event IDs/effective skills were unchanged. This is observed latency, not a guarantee that every provider request succeeds before the deadline.

The combined integration passes 131 offline tests; two real-call cases are skipped in that suite. TypeScript, frontend lint and Docker/Next.js production build pass. Runtime tests use temporary SQLite, official seed data and the actual recommendation route. They cover field/history preservation, fresh results after completion, missing key, provider failure, unknown employee, no target, 8-second transport abort, 9.5-second overall fallback and late results. Profile/completion make zero model calls even with a configured key.

Frontend integration remains a teammate task: request the AI endpoint separately, retain deterministic data while it loads, and discard stale responses after selection, completion or import. The current UI can render supplied AI text but does not yet request it separately. No browser AI success is claimed by these backend checks.

Official API behavior was checked against the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), including `text.format`, refusals, and incomplete responses.

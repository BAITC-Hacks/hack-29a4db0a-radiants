# AI explanation quality: verification and handoff

## Scope and release status

Base: main `1666aeb`, separate from draft completion-policy PR #18 and frontend PR
#19. This change preserves the public API DTO, deterministic ranking/weights,
model (`gpt-6-astra`), low reasoning effort, 2000-token limit and existing deadlines.
No new dependencies, training, model-driven event selection or client-side key.

**Offline verification passed; new live verification is pending on Backend's
laptop.** PR #16 proves the previous authenticated AI runtime, not this new
prompt/schema. Do not claim these changes have passed actual OpenAI requests yet.
The completion eligibility bypass remains a separate P0 until Backend integrates
#18. This independent branch does not include or disable that PR's red regression.

## Implemented improvements

1. The provider receives an explicit, detached evidence projection. Employee
   name/ID, full history, manager, department, arbitrary internal properties,
   scores, reason arrays and previous AI answers are not sent. Supplied catalog
   strings remain data, not trusted instructions. This is data minimization, not
   a guarantee that arbitrary catalog text can never contain personal information.
2. Nested target, effects, evidence-reference arrays and skill-name mappings are
   copied. A custom explainer cannot mutate the deterministic view or extend the
   validator's allowed references through shared objects.
3. Every refresh starts from clean deterministic fallback. A failed, partial or
   invalid new answer cannot leave an older AI answer labeled as current `llm`.
4. The request includes `preferred_language` (ru/kk/en) and readable skill names.
   Surrounding prose uses that language; catalog role/grade/skill labels remain
   unchanged so users and validation can match the displayed evidence. Existing
   deterministic fallback text remains English; this is not full UI localization.
5. Strict JSON Schema restricts each event's branch to its actual eventId and its
   own allowed evidence references, with exact batch size 1-3. Runtime validation
   still rejects unknown/duplicate events, duplicate/unknown references, extra
   fields, empty/oversized text and missing target/history/reduced-skill references.
6. Text must visibly contain the target role and grade, a genuinely reduced skill
   name or ID, and its supplied before -> after transition. Generic praise plus
   three reference labels is no longer enough to earn an `llm` label.
7. Conservative checks reject unknown EV_/SK_ identifiers, unsupported numerical
   arrow transitions, invented percentage metrics, URLs, HTML and hidden/control
   characters. Rejected cards retain deterministic explanations independently.
8. Safe provider error codes expose failure categories without raw transport
   exceptions, headers, keys or response bodies. Deadlines, abort, provider status,
   refusal, schema failure and partial-result fallback remain covered by tests.

## Limits: do not oversell validation

The text checks are narrow checks, not a semantic truth or prompt-injection proof.
They cannot prove that a free-text history paraphrase, an implied promotion claim,
or a skill-name/number association is accurate. A model might include correct
anchors and still add an unsupported sentence. The deterministic evidence remains
the source of truth and must remain visible in the UI.

The target and transition formatting checks deliberately prefer fallback to a
vague answer. They can also reject a semantically correct paraphrase that omits
the supplied names or uses another transition format. Measure the actual live
acceptance rate before merge; do not weaken safety checks merely to get a green
demo. Role and skill names must not be translated away from their catalog labels.

The English negative live case places hostile instructions in an event title. A
pass establishes resistance to that example only, not every possible attack.
Three languages and a few real calls are not a statistically meaningful benchmark.

## Verified locally

- Seven regression cases first failed for shared nested references, old AI text,
  metadata/language omissions, unconstrained schema, and generic explanations
  with valid reference labels; they pass after the fixes.
- Full `npm test`: **260 passed, 5 live skipped**. The five are the two existing
  persisted-service calls and three new language/negative quality cases.
- `npm run typecheck`, `npm run lint`, extra ESLint over AI modules and changed AI
  tests, `npm run build`, and `git diff --check` passed.
- Offline evaluation: all **200 profiles**, **173 batches**, **438 explanations**,
  all three preferred languages; no deterministic fields or source indexes changed.
  Its provider is deliberately a deterministic test double, not a live LLM.
- Existing actual-route tests use temporary SQLite and mocked OpenAI transport.
  They verify the unchanged HTTP envelope, completed history, fresh evidence after
  completion, privacy, timeout and fallback. These are not real provider calls.

Saved output: [full tests](evidence/ai-quality-2026-09-23/npm-test.txt) and
[offline evaluation](evidence/ai-quality-2026-09-23/offline-evaluation.txt).

## Backend: required help before merge

Keep the key in the existing ignored server environment. Never post `.env`,
headers, credentials or resolved Compose environment. Keep the privacy opt-out
`AI_EXPLANATIONS_ENABLED=false` respected; quality tests refuse to send requests
while that flag is false.

On the AI-quality branch, first run the normal test/typecheck/lint/build gate.
Then run the existing service smoke checks, explicitly opting into **two billed
requests**, with verbose output so individual results are not hidden:

```powershell
npm run test:ai-live -- --reporter=verbose
```

Next explicitly opt into **three additional billed requests**. They clone real
profiles to unknown IDs without touching your demo database, exercise RU/KZ/EN,
and place hostile instructions in one English-case event title:

```powershell
$env:RUN_AI_QUALITY = "1"
try {
  npx vitest run tests/ai-quality-live.test.ts --reporter=verbose
} finally {
  Remove-Item Env:RUN_AI_QUALITY -ErrorAction SilentlyContinue
}
```

These cases require actual `llm` output for every selected event, unchanged IDs,
order/scores/effects, named target/skill anchors, expected transitions and a
per-request time below ten seconds. Missing key, API/schema error, timeout or
fallback is a failure, never mislabeled as a successful AI answer.

Post the tested commit SHA and sanitized verbose output in the PR. The quality log
includes case/language, elapsed time, actual explanations, expected effects and
history signals for human review. Do not repeat paid calls just to generate the
same log. Diagnose the failed category first if a case fails.

After integrating with the final application branch, rebuild/recreate the server
and check a real employee login: new language-appropriate text, completion and
fresh explanation, plus fallback with external AI disabled. No API wiring or new
DTO is needed for this PR itself.

## Human review: user and teammates

Review every logged explanation against the supplied evidence:

- Correct target role/grade, actual skill and before/after/required levels?
- Critical skill clearly identified without promising promotion or salary?
- History paraphrase faithful: related misses/low feedback not hidden; sparse
  evidence not converted into a confident preference or motivation judgment?
- No invented session date, additional activity, gain above the teaching cap,
  or cumulative progress from independent alternatives?
- RU/KZ/EN prose natural, short and useful, with source names still recognizable?
- English hostile-title case ignores the embedded instructions, rather than
  echoing `COMPROMISED`, EV_999 or the external link?

Backend owns real calls and the deployed-source SHA. A Kazakh-speaking teammate
should review the KK prose; automated presence of Cyrillic is not fluency proof.
AI/Data owns correcting prompt/validation issues after those results. Frontend
keeps deterministic evidence and truthful source labels visible; no new controls
are required for these changes.

Official API shape, per-request enum/anyOf constraints, strict required fields,
refusals and incomplete responses were checked against the
[OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).

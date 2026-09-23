# Independent acceptance - 2026-09-23

> Historical report. Authentication findings below describe the reviewed revision; the subsequent privacy implementation and current checks are documented in BACKEND_PRIVACY.md and PRIVACY_VALIDATION.md.

Reviewer: AI/Data. Final merged runtime: `85a7f269bd553bb59f9ad8740e3f2312329d79a9` (PR #12, including PR #11). This review used an isolated Windows checkout and disposable SQLite database, not the team's demo database. No local OpenAI key was available.

## Final main commands

Executed after checking out the exact merged main revision:

| Command | Result |
| --- | --- |
| npm ci | 196 packages installed, 197 audited, zero reported vulnerabilities |
| npm test | 176 passed, 2 opt-in live cases skipped |
| npm run typecheck | Passed |
| npm run lint | Passed; components, hooks, frontend transport and frontend tests |
| npm run build | Next.js production build passed |

Full terminal output is attached to the acceptance-report PR. These checks do not constitute a local live OpenAI call.

## Independent browser checks

Initial product checks used `8dcbc23`; the missing-goal skills fix and combined engine were rechecked at `2638726`. Both are included in final main. The final main browser also verified the fast profile and fallback after a rebuild/restart.

- Initial seed was exactly 200 employees / 40 events / 60 skills / 32 role profiles / 2743 history rows.
- Without a key, E0178 showed six completed activities, three rule-based explanations and an explicit AI-unavailable status.
- Deliberately delayed, mocked AI responses were released after completion, employee selection and import. None replaced the current profile. These were controlled transport tests, not real model output.
- E0178/EV_005 completion changed readiness 71.3 -> 74.1, history from six to seven completed activities, and the recommendation list. A late pre-completion explanation did not restore the old state.
- Sequential JSON/CSV import through the dialog added JURY_DEMO_001 and two history records. Completed EV_005 and overdue mandatory EV_001 appeared in separate tables.
- Completion for the imported profile increased readiness 74.1 -> 76.9. Browser reload and a local server restart retained it and the two completed activities.
- HR rendered every returned row: 60 skill gaps, 27 employees without a next step and 40 activities on the checked state.
- E0175 without a career goal initially hid its 23 skills. This finding was resolved in `2638726`: all 23 named skills now render. JURY_LEAD likewise renders all 16 supplied skills and no invented target or recommendations.
- The three AI/Data jury profiles and six history records imported through the same UI. JURY_CRITICAL's first recommendation was Designing High-Load Systems, not the lowest Public Speaking skill. JURY_HISTORY retained System Design 2, API Design 4, Mentoring 1 and three completed activities.
- This local sequence ended at 204 employees / 2753 history rows. Its extra E0178 completion explains the one-row difference from Backend's independent rehearsal; the official catalog stayed unchanged.
- Desktop 1440x900 and mobile 390x844 screenshots showed no page-wide horizontal overflow. Tables retain their own scrollable regions. This was a focused visual check, not exhaustive accessibility certification.
- On final main, switching to E0058 displayed the profile in 244 ms with its AI HTTP request held by the test. Readiness was 53.9 and completion remained enabled. Releasing the request produced visible fallback. This is one local observation, not a production latency guarantee.

## Evidence boundaries and handoff

Backend's real OpenAI and Docker/browser evidence is recorded separately in [FINAL_VALIDATION.md](FINAL_VALIDATION.md): both E0178 and E0058 returned validated explanations, and the final browser displayed real AI text. This reviewer did not run those billed calls. Docker was subsequently checked independently as recorded below. Raw sanitized live terminal output remains useful release evidence; do not post credentials, headers or resolved Compose environment.

`next start` served this local production-build review but warned about `output: standalone`. The supported one-command demonstration remains Docker Compose as documented in [DEMO.md](DEMO.md); this review does not replace Backend's fresh-clone Docker rehearsal.

No unresolved functional regression was identified in the scoped checks. Keep the demo private and synthetic: there is no real employee/HR authorization. Explain readiness as a development indicator, recommendations as alternative next actions, and rule-based output as fallback rather than live AI. A short backup recording and final rehearsal on the Backend laptop remain presentation tasks for the team.

## Independent Docker follow-up

Docker Desktop 4.92.0 / Engine 29.8.0 / Compose v5.5.1 were installed and running on this reviewer's Windows machine. The checkout at `2ed1e8f` differs from runtime `85a7f26` only by this report. No application code or container configuration was changed. A new Compose project, `career-quest-independent-20260923`, used port 5196 and its own previously absent named volume. The OpenAI key was explicitly empty for this run.

```powershell
$env:APP_PORT = '5196'
$env:OPENAI_API_KEY = ''
docker compose -p career-quest-independent-20260923 up --build -d --wait --wait-timeout 120
```

- First image build passed, including Linux `npm ci` (197 packages installed, zero reported vulnerabilities), the production Next.js build and its TypeScript check. The container reached `healthy`.
- Fresh `/api/health`: 200 employees / 40 events / 60 skills / 32 role profiles / 2743 history records. This was a new volume, not reused local-demo state.
- In the actual browser, E0178 had readiness 71.3, six completed records and three explicitly rule-based explanations. Completing EV_005 changed readiness to 74.1 and System Design from 1 to 2, preserved API Design at 4, added exactly one history record (2744 total), and replaced EV_005 with the next recommendations. Browser reload preserved the result.
- Importing `docs/fixtures/jury-employee.json`, then `jury-history.csv`, through the UI added one employee and two history records. JURY_DEMO_001 showed readiness 74.1, completed EV_005 and overdue mandatory EV_001 separately. Reimporting the CSV skipped both existing records with a visible warning and did not change counts.
- HR rendered all 60 skill-gap rows, 27 employees needing a next step, and 40 activity rows on this state.
- `docker compose -p career-quest-independent-20260923 up -d --force-recreate --wait --wait-timeout 120` replaced the container while retaining the named volume. It returned `healthy`; API and browser checks retained E0178 readiness 74.1 and seven completed records, the imported profile at 74.1, and exact totals of 201 employees / 2746 history records. The official catalog remained 40 / 60 / 32.
- The recommendations endpoint still returned three `fallback` explanations without a key. This is an independent Docker/fallback check, not an additional live OpenAI verification.

The disposable review instance is available locally at http://127.0.0.1:5196 while Docker Desktop is running. It already contains the completion/import above; it is not a fresh demo seed. No team database or existing volume was deleted. A non-blocking `/favicon.ico` 404 was observed; no functional fix was needed for this check.

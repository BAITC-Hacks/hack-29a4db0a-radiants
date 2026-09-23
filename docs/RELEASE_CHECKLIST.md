# Release acceptance

Integration owner: @silence99999. AI/Data and acceptance: @luxaeternaaaa. Frontend: @Jubby786.
Source of coordination: GitHub issue #7. PRs #9 and #10 are merged into main at 06b46ad and replace the Vite-based AI integration from PR #6. Topic-aware ranking and jury fixtures are the separate `feat/recommendation-quality` follow-up.

## Verified locally on the persisted AI/Data branch

- Official seed health: 200 employees / 40 events / 60 skills / 32 profiles / 2743 history.
- Browser: 200 official employee options; no demo catalog.
- E0178/EV_005: readiness 71.3 -> 74.1, System Design 1 -> 2, API Design remains 4; history 2744; new recommendations.
- Browser reload and local server restart retain completion in SQLite.
- HR exposes 40 activity rows, 60 gap rows and 27 employees without recommendations on the checked state.
- Browser import, employees JSON then history CSV: 3 new profiles and 6 history records, official catalog counts unchanged.
- Reimport of the same history CSV: 0 inserted, 6 skipped; counts remain 203 employees / 2750 history after the one completion.
- JURY_HISTORY server view: System Design 2, API Design 4, Mentoring 1, three completed activities.
- Browser upsert of JURY_LEAD with Data Analyst / Middle goal: 0 inserted, 1 updated; readiness 43.8; EV_020, EV_025 and EV_022 displayed. Effective skills and all database counts remain unchanged.
- After that upsert, all 203 employee HTTP views independently reproduce HR gap frequencies and no-next-step IDs; participation totals match all 2750 history rows.
- Sequential warm local-dev profile HTTP requests: median 18 ms, p95 25 ms, maximum 37 ms. This is not a production UI render or real-AI latency measurement.
- AI endpoint without a key returns the same deterministic data; mocked real-route tests cover successful enrichment and provider failure.
- Pure engine: 200 profiles, 173 positive first completions, 787 recommendations validated before/after completion.
- After merging main 06b46ad into this branch: 142 offline tests passed, 2 live cases skipped; TypeScript, the configured frontend lint script and Next.js production build passed. npm ci installed 196 packages with 0 reported vulnerabilities.

These are local observations, not proof of live OpenAI or of the final merged release.

## Backend-reported verification

PR #10 reports a passing real E0178 service call and a second Docker HTTP call with three LLM explanations in 7026 ms, preserving readiness/skills/IDs. It also reports Docker build and healthy recreation. The full command output and final browser flow still need to be linked in issue #7; this agent did not run those live calls. E0058 was not executed live there.

## Final integration results

- [x] Completed activities and mandatory obligations are displayed separately. Known effective skills remain visible without a target; catalog names load independently.
- [x] AI fetch is separate from the fast profile; canceled or stale responses cannot overwrite selection/completion/import state.
- [x] Both E0178 and E0058 live checks passed. Sanitized output is recorded in FINAL_VALIDATION.md. Browser AI success and no-key fallback were also observed.
- [x] Combined branch: 176 offline tests, TypeScript and expanded frontend/hooks lint passed. Fresh-clone Docker ran npm ci and production build successfully.
- [x] Browser rehearsal covered JSON → CSV import, skipped duplicates, completion, HR, no-target skills, critical-gap priority and persistence after container restart/recreation. See FINAL_VALIDATION.md for the exact checked revisions and counts.
- [x] Runtime revision recorded: 2638726. Only documentation changes follow this runtime revision.

Optional presentation preparation for the team: record a short backup demo using DEMO.md. No recording was created by this validation run.

## Known limitations

- Server sessions and own-only/HR authorization are implemented; see BACKEND_PRIVACY.md and PRIVACY_VALIDATION.md. Corporate SSO, recovery and consent-based peer sharing remain future deployment work. Use the synthetic dataset for the demo.
- AI evidence validation checks schema, allowed references and required factors, not complete semantic truth.
- Ranking weights are explicit heuristics. There is no measured claim of improved employee engagement.
- Recommendations are alternatives for the next action, not a multi-step optimizer.
- The checked dev browser reports a favicon.ico 404; no application exception was observed in the completed flow.

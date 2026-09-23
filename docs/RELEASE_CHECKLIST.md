# Release acceptance

Integration owner: @silence99999. AI/Data and acceptance: @luxaeternaaaa. Frontend: @Jubby786.
Source of coordination: GitHub issue #7. PR #9 replaces the Vite-based AI integration from PR #6.

## Verified locally on the persisted AI/Data branch

- Official seed health: 200 employees / 40 events / 60 skills / 32 profiles / 2743 history.
- Browser: 200 official employee options; no demo catalog.
- E0178/EV_005: readiness 71.3 -> 74.1, System Design 1 -> 2, API Design remains 4; history 2744; new recommendations.
- Browser reload retains completion in SQLite.
- HR exposes 40 activity rows, 60 gap rows and 27 employees without recommendations on the checked state.
- Browser import, employees JSON then history CSV: 3 new profiles and 6 history records, official catalog counts unchanged.
- JURY_HISTORY server view: System Design 2, API Design 4, Mentoring 1, three completed activities.
- AI endpoint without a key returns the same deterministic data; mocked real-route tests cover successful enrichment and provider failure.
- Pure engine: 200 profiles, 173 positive first completions, 787 recommendations validated before/after completion.

These are local observations, not proof of live OpenAI or of the final merged release.

## Open gates

- [ ] Frontend displays completedActivities, and effective skills when target is null. Currently missing in the checked UI.
- [ ] Frontend calls the AI endpoint independently of initial profile loading, and rejects stale responses after completion/import/selection changes.
- [ ] Backend posts the full passing test:ai-live output from its laptop, then verifies actual browser AI and key-disabled fallback.
- [ ] Final release passes npm ci, npm test, npm run typecheck, npm run lint, npm run build after merge.
- [ ] Backend verifies final Docker startup, container restart persistence and the complete rehearsal in JURY_DEMO.md.
- [ ] Record the final commit SHA and a short demonstration recording; freeze features before presenting.

## Known limitations

- Authentication/authorization is not implemented. Employee/HR navigation is not access control; use a closed synthetic-data demo only.
- AI evidence validation checks schema, allowed references and required factors, not complete semantic truth.
- Ranking weights are explicit heuristics. There is no measured claim of improved employee engagement.
- Recommendations are alternatives for the next action, not a multi-step optimizer.
- The checked dev browser reports a favicon.ico 404; no application exception was observed in the completed flow.

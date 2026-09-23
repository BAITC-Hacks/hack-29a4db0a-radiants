# Final product validation — 2026-09-23

Runtime revision: `2638726` on `codex/final-product-integration`, including the refined frontend and PR #11's recommendation-quality work. Documentation-only updates follow this revision.

## Automated checks

- `npm test`: **176 passed**, two opt-in live cases skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed, including frontend hooks and frontend tests.
- Tests cover API transactions, rollback, duplicate records, seed counts, completion persistence, AI deadlines/fallback and stale-response rejection.
- Recommendation-quality checks cover 200 official profiles, 173 positive first completions and 787 recommendations before/after completion.

## Docker and browser rehearsal

A new Git clone outside OneDrive was built using `docker compose -p career-quest-acceptance up --build -d --wait`, with `APP_PORT=3001`. It uses a separate named volume and initially no API key. The existing port-3000 demo database was preserved.

- Initial health: **200 employees, 40 events, 60 skills, 32 role profiles, 2743 history records**.
- Browser displayed rule-based explanations and an honest AI-unavailable status without a key.
- Imported `docs/fixtures/jury-employee.json` through the dialog: one profile added; Jury Demo readiness **71.3%**.
- Imported `docs/fixtures/jury-history.csv`: two records added; readiness **74.1%**, EV_005 completed, EV_001 overdue at 40% with due date 2026-09-15. Completed and mandatory activities appeared in separate sections.
- **Import another file** allowed another CSV. Reimport inserted zero records and displayed **2 skipped**.
- Completed Designing High-Load Systems (EV_006) through the browser: readiness **74.1% → 76.9%**, System Design **2 → 3**, Observability **3 → 4**. New history and recommendations appeared immediately.
- Container restart and browser reload retained **76.9%** and history.
- HR displayed 201 employees after this flow. The department filter for Jury Demo returned one employee, three activities, two completed, one overdue, completion rate **66.7%**, and sources self=2 / hr=1 / manager=0.
- Also imported the three PR #11 jury profiles and their six history records through the same JSON → CSV flow. Combined acceptance database: **204 employees / 2752 history records**; catalog counts unchanged.
- Browser console warning/error log was empty during the initial rehearsal.
- Rebuilt the fresh clone at `2638726`: `npm ci` installed 197 packages, reported zero vulnerabilities; Next.js production build and Compose healthcheck passed. Existing acceptance history survived recreation.
- On the rebuilt UI, JURY_LEAD displayed all 16 known effective skills with catalog names and the explicit missing-goal state. JURY_CRITICAL's first recommendation was Designing High-Load Systems, addressing both critical engineering gaps rather than the unrelated Public Speaking level 0.
- Recreated the acceptance container with the existing ignored server `.env`, then selected Jury Demo. Its **76.9%** profile was visible while **Preparing AI explanations… Your plan is ready to use.** was shown. Three **AI-assisted explanation** blocks subsequently appeared for Architecture Review Circle, Leadership Foundations and Public Speaking Club. Readiness remained **76.9%**, and browser warning/error logs stayed empty. The explanations matched the new deterministic history wording and gaps.

The acceptance clone contains no copied key. The server key was supplied only to Compose at runtime using `--env-file`. The simple import rehearsal occurred before adding PR #11; after integration, all 176 tests passed and the rebuilt browser checks above verified its combined behavior and persisted state.

## Real OpenAI checks

Command: `npm run test:ai-live -- --reporter=verbose --silent=false`.
Both opt-in cases passed using the existing ignored server key and temporary SQLite databases. No credentials or complete provider payloads are recorded here.

| Employee | Request time | Recommendation IDs | Source |
| --- | --- | --- | --- |
| E0178 | 7789 ms | EV_005, EV_038, EV_036 | llm for all three |
| E0058 | 6854 ms | EV_012, EV_010, EV_040 | llm for all three |

The tests compare every deterministic recommendation field and completed history to the pre-request view. IDs, score, order, readiness and skill effects are unchanged. Observed latency is not a guarantee; the provider deadline and deterministic fallback remain active.

### Sanitized explanation output

**E0178 / EV_005:** System Design Fundamentals supports the Senior Backend Engineer target with an expected System Design increase from 1 to 2, still below the required level 4 for this critical skill. One recent participation signal involving related skills and this format reduces suitability.

**E0178 / EV_038:** Leadership Foundations supports the Senior Backend Engineer target with expected increases in Leadership and Stakeholder Management, each from 1 to 2, meeting their required level 2. The one negative participation record concerns only the format on unrelated topics, so it carries limited weight.

**E0178 / EV_036:** Public Speaking Club supports the Senior Backend Engineer target with an expected Public Speaking increase from 1 to 2, meeting the required level 2. No recent comparable participation records are available, so there is insufficient evidence to infer a preference or motivation.

**E0058 / EV_012:** Advanced Python supports the Middle Backend Engineer target by increasing the critical Python skill from 2 to 3, meeting the required level of 3. There are no recent comparable participation records, so evidence is insufficient to infer a preference.

**E0058 / EV_010:** Kubernetes in Practice supports the Middle Backend Engineer target by increasing Containers & Orchestration from 1 to 2, meeting the required level of 2. It also increases CI/CD from 0 to 1, leaving a gap to the required level of 2. There are no recent comparable participation records, so evidence is insufficient to infer a preference.

**E0058 / EV_040:** Structured Problem Solving supports the Middle Backend Engineer target by increasing Problem Solving and Teamwork each from 2 to 3, meeting their respective required levels of 3. There are no recent comparable participation records, so evidence is insufficient to infer a preference.

Human review of these six outputs found the target, skill changes and history claims consistent with the deterministic evidence. This is a limited rehearsal, not a general semantic-truth guarantee.

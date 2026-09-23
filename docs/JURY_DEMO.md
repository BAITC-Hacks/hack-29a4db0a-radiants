# Jury rehearsal

## Data and startup

The supplied dataset is synthetic. Use the Backend demo laptop and one tested Next.js/SQLite build.
Run `docker compose up --build`. A server key in ignored `.env` enables AI; an absent key uses deterministic fallback. If the team uses `.env.local` instead, add `--env-file .env.local` after `docker compose`.
Never post the key or resolved Compose environment. Keep the repository private.

Use a fresh, separately named Compose project/volume for a clean rehearsal. For example, set `APP_PORT=3001` in the shell or ignored `.env`, then run `docker compose -p career-quest-jury-01 up --build` and open port 3001. The existing demo can continue on port 3000 with its own volume. Use a new project name for each clean rehearsal. Clearing localStorage does not reset SQLite.

Check `GET /api/health`: 200 employees, 40 events, 60 skills, 32 role profiles, 2743 activityHistory rows.

## Three-minute demonstration

1. Open E0178, Backend Engineer Middle -> Senior, readiness 71.3. Show assessed versus effective skills, completed history and recommendation evidence.
2. Explain EV_005 with the actual target, critical System Design gap, current history signal and skill effect. Identify whether the text is LLM-generated or fallback; do not call deterministic output a live AI answer.
3. Complete EV_005. System Design rises 1 -> 2, API Design stays 4 despite the course cap of 3, readiness rises 71.3 -> 74.1 (+2.8 percentage points). The next recommendations change. Health history is now 2744.
4. Reload and select E0178 again; persisted progress must remain. Restart the server/container and repeat.
5. Import the three profiles below, then their CSV. Open JURY_CRITICAL and explain why a critical engineering gap wins over the lowest speaking skill. Show HR's complete lists.

Keep a short recording of the actual successful run as a presentation backup, clearly identified as a recording.
Do not promise measured engagement improvement, promotion, or production access control. These are not established by the prototype.

The independently recorded two-minute fallback run, Russian speaker notes and remaining team handoff are documented in [FINAL_REHEARSAL.md](FINAL_REHEARSAL.md). It does not replace the Backend laptop's live-AI rehearsal.

## Importable check profiles

Upload `docs/jury/employees.json`, then `docs/jury/activity_history.csv` in the existing dialog.
Alternatively, send both as `employees` and `history` multipart fields to `POST /api/import` for one transaction.
They use only official skill/event IDs and introduce no extra catalog entries.

| Profile | Adversarial condition | Expected behavior |
| --- | --- | --- |
| JURY_CRITICAL | Public Speaking 0, three recent speaking no-shows, critical engineering gaps | First recommendation reduces a critical engineering gap, not simply the lowest skill |
| JURY_HISTORY | Missing Python/Mentoring; pre-review Cloud history; post-review EV_005/EV_037; API Design already above course cap | Python gap reads 0; Mentoring 1, System Design 2, API Design 4; completed EV_005 excluded |
| JURY_LEAD | Lead without a goal, with known effective skills | needs_career_goal; no invented next grade; skills remain available |

Successful import adds 3 employees and 6 history rows: 203 employees / 2749 history on a fresh seed, or 2750 after the one E0178 completion above.
Reimporting the same CSV skips all six record IDs without further skill gain.
To test a goal change, upsert JURY_LEAD with `career_goal: { target_role: "Data Analyst", target_grade: "Middle" }`; the target and relevant recommendations must change.
On the supplied fixture this updates one existing employee, not a new record: readiness becomes 43.8, recommendations are EV_020 / EV_025 / EV_022, effective skills stay identical and history counts do not change. The current UI import path was checked for this case.

## Quality tests, not just arithmetic

`npm test -- tests/recommendation.test.ts tests/recommendation-quality.test.ts --reporter=verbose --silent=false`

- All 200 official profiles; 173 first recommendations increase readiness; no skill decreases; preview matches completion.
- Independent eligibility checks before and after each completion.
- An equally useful next step changes when related attendance history changes.
- Renaming a profile to an unseen ID and changing an irrelevant skill leave recommendations unchanged.
- Unrelated topic feedback cannot promote a candidate. Weak format-only history cannot receive the same penalty as related-topic history.
- Critical gaps outweigh an unrelated lowest skill. Sparse history is not represented as positive motivation.

## Real AI gate

Run `npm run test:ai-live` on the Backend laptop with the ignored server key. This is a billed, opt-in test of two official profiles through the persisted service, using temporary databases. It must return actual llm explanations within 10 seconds, without changing deterministic fields. Review the printed explanations against target, gap and history facts.
Then verify the browser actually calls the AI endpoint and displays its text. A passing provider test alone does not prove UI integration.
Finally recreate the test container without the key and verify fallback. Never retry completion merely because an AI explanation failed.

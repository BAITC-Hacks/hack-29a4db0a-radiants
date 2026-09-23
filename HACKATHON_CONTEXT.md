# Career Quest - Hackathon Context

## Purpose

This is the persistent working context for the HackAlem AI / Halyk Bank **Career Quest** case. It consolidates the official five-page brief and the starter-dataset README. It is not a replacement for the original materials: where ambiguity remains, verify against:

- Official brief: `C:\Users\foxal.DESKTOP-N1GCIEU\Downloads\HackAlem AI_ Career Quest - платформа геймификации жизненного цикла сотрудника..pdf`
- Dataset: `C:\Users\foxal.DESKTOP-N1GCIEU\Downloads\career_quest_dataset\case_1\career_quest_dataset`

## Case

- Customer: Halyk Bank.
- Track: AI for corporate products.
- Case: Career Quest - employee lifecycle gamification platform / AI development navigator.
- Team: three people, with a five-hour build window.
- Product type: full-stack web application with an AI layer.

The problem is fragmented HR events: employees do not see how training, mentoring, assessment, and other activities connect to their growth. They complete mandatory items late and do not attend voluntary activities. The solution must make a development path and the value of each next step visible.

## Users And Main Demo

Primary user: an employee with 1-5 years of tenure. The demo path is:

1. Open any employee profile.
2. Show role, grade, skills, completed activities, current target, and readiness/gaps.
3. Recommend 1-3 valid voluntary development activities and explain each with real evidence.
4. Mark one activity completed.
5. Show updated effective skills, trajectory/progress, and recalculated recommendations.
6. Switch to the HR view for weak competencies, employees with no valid next step, and participation by activity.

Secondary user: HR or a department manager. Employee engagement details must not be public to other employees.

## What Is Being Judged

The total score is 100:

| Area | Points |
| --- | ---: |
| Task fit and working functionality | 25 |
| Technical implementation and truthful AI architecture | 25 |
| README and reproducibility | 25 |
| Value and applicability | 15 |
| Development potential and originality | 10 |

Recommendation quality and explainability are the core. Gamification is optional and must not displace the working recommendation flow.

## Required Product Behavior

- Load the four supplied data files and support additional valid employee profiles/history records in the same schemas for hidden evaluation.
- For any employee, show a visible trajectory to a target grade or career goal, skills, completed activity history, and next steps.
- Generate 1-3 dynamic recommendations. They cannot be hardcoded for the starter 200 profiles.
- Explain recommendations using at least three contextual factors across grade/target requirement, skill gaps, and participation history.
- Handle an activity completion and immediately update the relevant skills, readiness/trajectory, and recommendation list.
- Provide a simple HR screen for frequent competency gaps, people without recommendations, and activity participation.
- Start with one documented command and provide a reproducible README.

## Dataset Contract

Snapshot date: **2026-10-01**. Treat it as “today” in all dataset business logic; never use the machine date. The history window is 2024-10-01 through 2026-09-30.

| File | Verified contents |
| --- | --- |
| `skills.json` | 60 skills; proficiency scale 0-5; 32 role/grade profiles (8 roles x 4 grades) |
| `employees.json` | 200 employee profiles with current assessed skills and optional career goals |
| `events.json` | 40 activities, including audience, prerequisites, skill effects, and sessions |
| `activity_history.csv` | 2,743 participation records over 24 months |

The roles are Backend Engineer, Customer Support Specialist, Data Analyst, Frontend Engineer, HR Business Partner, Product Manager, QA Engineer, and Sales Manager. Grade order is Junior, Middle, Senior, Lead. Role requirements do not decrease between grades.

`employees.skills` is the assessment state as of `last_review_date`, not necessarily the current state. Missing skills equal 0. Activity completions after the review date must be applied to build `effective_skills`.

```text
effective_skills = assessed employee.skills
for every completed activity after last_review_date:
  for each event skill effect:
    level = min(level + gain, max_level)
```

`role_profiles.required_skills` supplies target minima; `critical_skills` must receive extra importance. The default target is the next grade in the current role unless a valid `career_goal` changes the target. A Lead without a usable goal needs an explicit fallback state rather than a fabricated next grade.

Each event supplies `mandatory`, target roles/grades, prerequisites, `develops_skills`, format, and upcoming sessions. Self-paced events have an empty session list and are available at any time. Scheduled events are available only with a session on or after the snapshot date.

History includes `completed`, `in_progress`, `dropped`, `no_show`, `declined`, and `overdue`, along with feedback, assignment source, and recency. Use these as suitability signals; do not ignore repeated no-shows, drops, or declines on similar activities.

## Recommendation Rules

The deterministic engine must:

1. Reconstruct effective skills.
2. Resolve a target role/grade and calculate each required-skill delta.
3. Give critical target gaps a higher weight than non-critical gaps.
4. Build candidates only from voluntary, applicable, currently available events with satisfied prerequisites.
5. Exclude normally completed events; only `EV_036` is repeatable.
6. Exclude already in-progress activities from a new recommendation list unless the product deliberately presents them as a separate continuation state.
7. Simulate every candidate’s skill effects and rank by demonstrated reduction of target gaps, especially critical gaps, adjusted by history suitability.
8. Return at most three recommendations with deterministic evidence: before/after skill level, requirement, gap reduction, critical status, availability, and relevant history facts.

Mandatory or compliance obligations must be presented separately, never mixed into career-development recommendations.

The hidden profiles are designed to reject a one-field heuristic. Example: an employee may have the lowest Public Speaking score, repeated misses for similar events, and a critical System Design gap for promotion. The engine should prefer the relevant critical gap, not blindly choose the numerically lowest skill.

## AI Layer

AI must be real and contextual, but it must not own exact business rules. Preferred pattern:

```text
dataset loader -> deterministic eligibility and simulation -> ranked candidate evidence
  -> LLM structured explanation or candidate ordering -> schema/business-rule validation -> UI
```

The LLM must receive only eligible candidates and evidence. Validate every returned event ID against the deterministic set and use a deterministic fallback if the model is unavailable, slow, malformed, or selects an ineligible event. Do not let the model invent skills, requirements, history, dates, or impact.

Target responsiveness: UI under 2 seconds and AI recommendation under 10 seconds.

## Security, Privacy, And Non-Goals

- The dataset is synthetic and must not be exported beyond the hackathon.
- Keep employee and HR access logically separate.
- Do not expose engagement data to other employees without consent.
- Do not build public employee performance rankings.
- Do not gamify mandatory processes such as timesheets.
- Do not spend P0 time on currency, badges, a reward store, social mechanics, open-ended chat, or infrastructure that does not support the core path.

Useful P1 additions after the core works: readiness-delta visualization, “why this / why not”, Russian/Kazakh localization, stronger history similarity, and an import UI. Optional features such as recognition, rewards, attrition prediction, calendar integration, and an extended HR dashboard remain P2.

## Must-Pass Scenarios

- A critical target gap beats an unrelated lowest skill.
- Repeated no-shows/drops/declines lower suitability for similar activities.
- Missing skill is treated as 0.
- Post-review completed activities update effective skills and respect `max_level`.
- Mandatory and non-repeatable completed activities are excluded; `EV_036` remains eligible to repeat.
- Unmet prerequisites and scheduled events with no future sessions are excluded.
- A self-paced event with no sessions is eligible.
- Completing a recommended event changes trajectory and the following recommendations.
- Additional valid employee/history data loads without source changes.
- A malformed or ineligible LLM event is rejected and a safe fallback is shown.

## Known And Unknown

Known: official case, dataset schema, snapshot date, required flows, constraints, and evaluation traps.

Still unknown and must be inspected rather than assumed: shared repository, chosen frontend/backend stack, persistence model, deployment target, authentication boundaries, available API keys, team ownership, and final deadline. No application architecture should be created around these assumptions before the repository is available.

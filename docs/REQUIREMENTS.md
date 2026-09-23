# Career Quest - Build Requirements

## Source And Priority

This document turns the official HackAlem AI / Halyk Bank Career Quest brief and starter-dataset README into build and acceptance requirements. The official PDF and dataset contract win in any conflict.

## P0 Scope

Build a web application with a contextual AI layer for employee development. The smallest complete release includes:

1. Data loading and validation for `skills.json`, `employees.json`, `events.json`, and `activity_history.csv`.
2. Employee profile and trajectory.
3. A deterministic recommendation engine with 1-3 valid recommendations.
4. Evidence-based explanation for each recommendation.
5. Activity completion that recalculates skills, progress, and recommendations.
6. A concise HR analytics view.
7. Import of additional valid employee/history files.
8. One-command startup, tests, and a complete README.

## Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | Open an arbitrary employee and show role, grade, skills, completed activities, target/trajectory, and next steps. |
| FR-02 | Show a visible development path: current position, next target, readiness/gaps, and actions. |
| FR-03 | Dynamically return one to three relevant voluntary activities. Do not hardcode for the 200 starter profiles. |
| FR-04 | Explain every recommendation using multiple factors: target/grade requirement, skill gap, and participation history. |
| FR-05 | Mark an activity complete and refresh its skill effects, trajectory/readiness, and recommendations. |
| FR-06 | Let HR see common missing skills, people without valid recommendations, and activity participation. |
| FR-07 | Import additional profiles/history records in the same schema without source changes. |
| FR-08 | Start from a documented single command. |

## Business Rules

### Effective Skills

- Start from `employees.skills`; an absent skill has level 0.
- Apply every `completed` history record dated after `last_review_date` using the corresponding event’s `develops_skills`.
- Team implementation policy for every gain: `new_level = max(current_level, min(current_level + gain, max_level))`. The activity cap limits growth and never lowers an attained level.
- Use the fixed snapshot date `2026-10-01` for availability logic.

### Target And Gap Logic

- Read target requirements from the matching `(role, grade)` profile.
- Prefer a valid `career_goal`; otherwise target the next grade in the employee’s current role.
- Compare `effective_skills` against every required skill.
- Mark `critical_skills` as special promotion blockers and weight them above non-critical gaps.
- Never represent readiness as a guaranteed promotion decision.
- Readiness is the weighted mean of `min(current / required, 1)` across target requirements, with critical weight 2 and other weight 1, multiplied by 100 and rounded to one decimal. Zero-level requirements are fulfilled; an empty requirements list yields 100. No target yields readiness 0.

### Candidate Eligibility

An activity can enter the recommendation pool only when all are true:

- `mandatory` is false.
- It applies to the employee role/grade or target intent according to the product’s documented matching policy.
- All prerequisites are satisfied by effective skills.
- It has not been completed before, except `EV_036`.
- It is not already an active in-progress item being presented as a new recommendation.
- It is currently available: self-paced with an empty session list is available; scheduled events need a session on/after 2026-10-01.

Show mandatory obligations separately from voluntary development recommendations.

### Ranking And Explanation

- Simulate each candidate’s changes to skills and target gaps before ranking it.
- Favor total target-gap reduction, especially reduction of critical gaps.
- Use history signals: status, similar event type/format, feedback, assignment source, and recency. Repeated misses, drops, and declines should lower suitability for similar activities.
- Store displayable evidence for every pick: target requirement, current level, expected level, critical status, gap reduction, and history signal.
- An explanation must never invent a data fact.

## AI Boundary

Use deterministic code for business rules. An LLM may order pre-filtered candidates or write a concise explanation, but must receive only candidate evidence and return structured data. Validate returned IDs and schema before presentation. On failure, use the deterministic ranking with a templated evidence-based explanation.

## Acceptance Tests

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC-01 | Open any valid employee | Profile, skills, completed activities, trajectory, and next steps are visible. |
| AC-02 | Eligible employee | Returns 1-3 recommendations. |
| AC-03 | Recommendation shown | Explanation cites multiple real factors. |
| AC-04 | Critical target gap versus unrelated lowest score | Critical target gap can win. |
| AC-05 | Repeated misses for similar events | Ranking considers the negative history. |
| AC-06 | Completed activity after review | Effective skill reconstruction includes it. |
| AC-07 | Gain over cap | Growth stops at `max_level`; an already higher level is preserved in preview and completion. |
| AC-08 | Mandatory event | It is absent from career recommendations. |
| AC-09 | Completed event | It is absent unless it is `EV_036`. |
| AC-10 | Unmet prerequisite | Activity is absent from candidates. |
| AC-11 | Self-paced empty sessions | Activity can be eligible. |
| AC-12 | Scheduled activity with no future session | Activity is unavailable. |
| AC-13 | Completion action | Skills, trajectory, and recommendations refresh; partial target-gap reduction increases readiness, and no skill or readiness decreases. |
| AC-14 | Hidden import data | Valid extra profiles/history work without code changes. |
| AC-15 | LLM returns unknown/ineligible event | Backend rejects it and uses a safe fallback. |
| AC-16 | Reviewer starts project | One documented command works. |

## Non-Goals

Avoid before the core passes: reward economies, leaderboards, social recognition, an open-ended assistant, mobile apps, calendar/messenger integrations, attrition prediction, expanded HR modules, and decorative gamification. They are optional enhancements, not a substitute for recommendation correctness.

## README Checklist

Document architecture, technologies, environment variables, single-command startup, test command, data loading/import, AI guardrails, and the main employee-to-HR demo scenario. State the snapshot-date rule and whether a valid API key is required for optional LLM enhancement.

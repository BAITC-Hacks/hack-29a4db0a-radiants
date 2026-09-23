When working with OpenAI APIs, models, tools, Agents SDK, or Codex,
use the OpenAI Developer Docs MCP to verify current syntax and behavior.

# Hackathon Operating Context

This folder is the working context for a 5-hour HackAlem AI hackathon.
The selected Halyk Bank case is **Career Quest**: an AI navigator for employee development.

Before making a substantial change, read [HACKATHON_CONTEXT.md](HACKATHON_CONTEXT.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). These documents summarize the official case brief and the starter-dataset contract. The official PDF and dataset README remain the source of truth if a conflict appears.

## Goal

Deliver a working web application that:

- opens an arbitrary employee profile and career trajectory;
- returns 1-3 relevant, explainable development steps;
- updates skills, progress, and recommendations when an activity is completed;
- gives HR a concise view of skill gaps, employees without a valid next step, and activity participation;
- imports additional employee/history data in the same schema without code changes;
- starts with one documented command.

Quality and explainability of recommendations matter more than cosmetic gamification.

## Implementation Rules

- Inspect the actual repository and existing stack before choosing architecture or dependencies.
- Build one complete vertical slice before expanding scope.
- Keep business rules deterministic: effective-skill reconstruction, eligibility, prerequisites, availability, repeat rules, mandatory-event exclusion, and skill arithmetic belong in code.
- An LLM, if used, receives only deterministic eligible candidates and must be validated before its output reaches the UI. Use structured output where machine-readable data is required.
- Do not hardcode behavior for the supplied 200 employees; hidden profiles and history will use the same schema.
- Treat missing employee skills as level 0 and use `2026-10-01` as the dataset snapshot date.
- Never recommend mandatory events; completed events cannot recur except `EV_036`; self-paced events with an empty session list are available.
- Prioritize critical requirements of the next target grade and participation history alongside skill gaps. A one-factor “lowest skill” rule does not satisfy the case.
- Keep employee and HR views logically separated. Do not add public performance leaderboards or use real personal data.
- Do not add infrastructure, reward economies, or unrelated features before the core flow is working.

## Working Style

- Optimize for an end-to-end MVP, reliable demo behavior, and clear evidence in the UI.
- Before a major implementation, state a concise plan, assumptions, non-goals, and main demo flow.
- Preserve existing functionality and unrelated user changes.
- Validate with relevant tests, build, and the actual user flow; do not declare completion from code inspection alone.
- Keep the README current with architecture, setup, environment variables, data import, test execution, and the demo scenario.

## Dataset Source

The supplied files currently live outside the repository at:

`C:\Users\foxal.DESKTOP-N1GCIEU\Downloads\career_quest_dataset\case_1\career_quest_dataset`

They contain 200 employee profiles, 40 events, 60 skills, 32 role/grade profiles, and 2,743 history records. See the context files for their schema and rules.

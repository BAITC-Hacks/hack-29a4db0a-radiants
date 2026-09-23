# Frontend: clearer employee flow

Based on main `a81b15f`. Frontend-only: API contracts, eligibility, scores, history
replay, readiness arithmetic, authentication and AI selection are unchanged.

## Changes

- Unframed profile/HR sections, compact typography and spacing, 8px recommendation
  cards, no nested effect cards. Skill gaps stay beside the next-step choices on
  desktop; the page becomes a single column on narrow screens.
- Plain-language progress explanation instead of a raw formula; help for the 0-5
  skill scale. Remaining gaps appear before already-met requirements without
  changing any supplied values.
- Recommendation cards show purpose, duration/date, actual expected gains and
  history evidence. Unchanged capped skills move into a disclosure; no internal
  ranking score or duplicated machine-generated reasons in the employee UI.
- Fixed engine templates are presented in Russian; unknown text remains intact.
  This is presentation, not a second ranking/history algorithm. Catalog titles
  and skill names are preserved. Validated AI text is displayed verbatim; stale
  AI text on a fallback response is never shown.
- Completion first opens a native confirmation dialog. Cancel/Escape sends no
  request; confirmation delegates to the existing completion lifecycle. The
  dialog explains persistence and the simulated scheduled date. HR still has
  no completion controls.
- Full participation history is expandable; completed and mandatory activities
  remain separate. AI fallback status is below the main workflow, not above it.
- Empty-state diagnostics use understandable reasons; unmet prerequisite skill
  names and exact levels are retained. HR participation is labeled as records,
  not unique people (repeat participation exists).

## Browser verification

Production Docker build on port 5200; Chrome, synthetic data, demo-name login,
external AI disabled. A separately imported temporary profile was used for
completion; existing employee progress was not changed.

- Employee view at 1440, 390 and 320 px: no page-level horizontal overflow.
- Desktop HR, full employee page and mobile confirmation screenshots inspected.
- Cancel and Escape: zero completion POSTs.
- Confirm: exactly one completion POST; readiness 71.3 -> 74.1; one new history
  record; persisted after reload. Full-history disclosure opens successfully.
- No browser page errors. Existing stale-AI lifecycle tests remain in the suite.
- Real OpenAI was not called or evaluated in this frontend pass.
- `npm test`: 377 passed, 2 opt-in live tests skipped. Typecheck, frontend lint
  and production Docker/Next build passed.

Screenshots from the local check are in ignored `.data/frontend-ux`. No real
employee data or credentials are included. Use the existing individual-login
mode for privacy checks; shared demo mode intentionally provides no identity
assurance.

## Compatibility

The upcoming Backend plain-Russian readiness message can merge independently;
this change does not edit recommendation engine or Vitest configuration.
Browser scripts that clicked completion directly must now confirm the dialog.
Assertions on raw English fallback text should check the displayed localized
facts instead. Catalog translations, editable career goals and new AI behavior
are not included.

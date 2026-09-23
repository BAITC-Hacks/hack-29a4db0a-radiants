# Final five checks: independent acceptance

Application source: **cedd34dc4d5a85abf554abbf4a99388fc1702686** (merged PR #21,
including #18/#19). PR #20 is **not** included. This report does not certify a
later application commit.

## Result

Production Docker / Node 22, fresh isolated volume, Chrome browser, 2026-09-23.
`DEMO_EMPLOYEE_LOGIN=false`, `AI_EXPLANATIONS_ENABLED=false`, empty provider key.
Other running demo containers and their volumes were not changed.

| Check | Actual result |
| --- | --- |
| Fresh official seed | 200 employees, 40 events, 60 skills, 32 role profiles, 2743 history records |
| Browser import | HR uploaded additional profile JSON followed by CSV; 1 employee and 2 history records added |
| Duplicate history | Browser reimport skipped both records; the complete employee view was unchanged |
| Private imported account | Created through HR UI, logged HR out, signed into the new employee account |
| Other profile and AI | Both E0178 detail and recommendation endpoints returned 403 FORBIDDEN |
| HR permissions | HR summary, account listing, account creation and import returned 403 FORBIDDEN |
| Mutation authenticity | Denied POSTs included valid Origin and the employee session's valid CSRF token, not a deliberately broken token |
| Denial rollback | Health counts and the employee view unchanged; account count later verified from HR |
| Fallback | AI endpoint returned the unchanged deterministic view in 19 ms; all three recommendations marked fallback |
| Visible evidence | Target Backend Engineer / Senior; named skill gaps, critical labels, before/after/required levels, and explicit insufficient-history signal visible |
| Browser completion | Imported profile completed EV_006: readiness 74.1 -> 76.9 (+2.8 pp), history 2 -> 3; no skill decreased |
| Persistence | Profile survived page reload and real container restart; personal session remained valid |
| HR refresh | Imported department population 1, activities 3; total account count remained 4 |

EV_006 is valid **for this imported profile after its CSV supplies EV_005**:
System Design is already 2. This does not contradict the required 422 for the
original E0178 with System Design 1. The original regression passed separately.

The screenshot shows rule-based, not model-generated, explanations. Russian UI
and English catalog/explanation text coexist; do not claim full localization.

- [Safe machine-readable report](evidence/final-five-checks-2026-09-23/report.json)
- [Imported employee and visible evidence](evidence/final-five-checks-2026-09-23/imported-profile-fallback.png)

## Verification commands

All ran against the application source above:

```text
npm test -- tests/auth.test.ts tests/imported-account-access.test.ts tests/completion-integration.test.ts tests/frontend-ai-control.test.ts tests/frontend-render.test.ts tests/jury-import.test.ts
Test Files 6 passed; Tests 71 passed; Duration 22.56s

npm test
Test Files 28 passed | 1 skipped (29)
Tests 373 passed | 2 skipped (375)
Duration 43.35s

npm run typecheck -> exit 0
npm run lint -> exit 0
docker compose -p career-quest-five-checks-20260923 up --build -d -> exit 0
```

The Docker build ran `npm run build` successfully with TypeScript and all routes.
Its `npm ci` layer was cached; no fresh local `npm ci` was claimed in this run.
The repository lint command covers frontend files, not all backend code.
Both skipped tests make paid provider calls and were not enabled here.
The finalized browser script was repeated on a second fresh container using the
same built image: all checks passed again (fallback endpoint 18 ms). The saved
report and screenshot above are from the first run on port 5200.

## Repeating the browser acceptance

Use a new isolated Compose project/volume and an unused port. Never reset the
team's working volume to run this script. The script imports data, creates an
account, completes an event and restarts its explicitly named container.

```powershell
$env:APP_PORT = "5200"
$env:APP_ORIGIN = "http://localhost:5200"
$env:DEMO_EMPLOYEE_LOGIN = "false"
$env:AI_EXPLANATIONS_ENABLED = "false"
$env:OPENAI_API_KEY = ""
docker compose -p career-quest-five-checks-new up --build -d --wait
$env:ACCEPTANCE_CONTAINER = "career-quest-five-checks-new-app-1"
$env:ACCEPTANCE_URL = "http://localhost:5200"
node scripts/final-five-checks.mjs
```

This optional operator script requires Chrome and Playwright in the operator's
tooling. It adds no application dependency. Set `PLAYWRIGHT_MODULE` to an existing
Playwright module location if it is not locally resolvable (this run used the
bundled Codex runtime). Output defaults to ignored `.data/five-checks`.
Initial credentials are read privately from the named container; no credentials,
cookies or CSRF tokens are written into the report. The screenshot contains only
synthetic employee data and is intended for this private hackathon repository.

## Still open: real AI on the final build

**Backend must provide this evidence on the laptop holding the server key.**
This local acceptance is not a substitute for live provider verification.

1. Record the exact final source SHA; keep individual authentication enabled.
2. Import the extra profile/history, create personal access, and sign in as it.
3. With external AI enabled, capture an actual recommendation response under
   10 seconds with nonempty `aiExplanation` and `explanationSource: llm`.
4. Confirm IDs/order/scores/effects match the deterministic profile; capture the
   visible target, gap, history signal and expected skill effect without secrets.
5. Disable external AI and check usable fallback, then restore the intended demo
   configuration. Publish sanitized timings, tested SHA and screenshot.
6. PR #20 requires its own live gates before inclusion; older screenshots prove
   only their recorded application version.

No application, API, DTO, authorization or ranking changes were needed for the
checks above. The remaining live gate is explicitly unverified on this machine.

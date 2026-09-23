# Frontend: completion validation and personal career goal

## Completing an activity

The existing endpoint and successful response are preserved:

```text
POST /api/employees/:employeeId/activities/:eventId/complete
```

Send the current employee session cookie, `X-CSRF-Token`, and JSON `{}` (or the existing `completedAt`, `score`, `feedbackRating` fields). A successful response is **201**:

```ts
{ data: { activity: ActivityRecord, view: EmployeeDetail,
  progress: { before: number, after: number, delta: number } } }
```

Use `view` to replace the displayed profile and `progress` for the actual readiness change. Cancel outstanding AI requests before submission; request new explanations separately after receiving the updated deterministic profile. The completion response never waits for an LLM.

The server holds one SQLite write transaction while loading the employee/event/history, checking repeat policy and domain eligibility, inserting one history record, and recomputing the profile. A failed check or recomputation rolls back the transaction. Assessed `employee.skills` are never incremented by completion.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 422 | `EVENT_NOT_ELIGIBLE` | Audience, prerequisites, availability, mandatory assignment, or the selected completion date do not permit completion. Show `error.message` / `details[].message`; no progress or history was saved. |
| 409 | `EVENT_ALREADY_COMPLETED` | Non-repeatable activity already completed. Refresh the profile; do not insert another local completion. |
| 404 | `EVENT_NOT_FOUND` | Event ID does not exist. |
| 401 | `AUTH_REQUIRED` | Sign in again. |
| 403 | `FORBIDDEN` | Only the employee can complete their own activity. HR cannot bypass this rule. |
| 403 | `CSRF_INVALID` / `ORIGIN_FORBIDDEN` | Refresh the session or fix the application origin; do not bypass the check. |
| 400 / 422 | `INVALID_JSON` / `VALIDATION_ERROR` | Invalid body; display the validation error. |

`E0178 + EV_006` is a blocked regression case. Supplying `completedAt` cannot bypass its missing prerequisites. New scheduled activities require a listed session on/after the fixed snapshot `2026-10-01`. Self-paced and already active participation complete on exactly that snapshot date, including a scheduled participation whose original session has passed. Explicit historical dates belong in the validated history-import flow, not self-service completion.

Completion does not require membership in the top three recommendations or reduction of a target gap. Mandatory obligations require the latest stored participation to be active (`in_progress`/`overdue`) and assigned by HR or a manager. This is a team completion policy; the browser cannot assert an assignment. Its `assigned_by` and `due_date` are preserved in the new completed record. Already active activities remain subject to audience and effective-skill prerequisites. They remain separate from newly recommended voluntary steps. Only `EV_036` may repeat.

## Updating your career goal

```text
PATCH /api/employees/:employeeId/career-goal
```

Allowed only for an authenticated employee changing their own profile. HR and other employee sessions receive 403. The JSON body must contain exactly one property:

```json
{
  "career_goal": {
    "target_role": "Backend Engineer",
    "target_grade": "Lead"
  }
}
```

`{ "career_goal": null }` clears the explicit goal: the existing engine then uses the next grade in the current role, or `needs_career_goal` for a Lead without another target. Clearing a goal does not necessarily remove the default career target.

Populate role/grade choices from `GET /api/catalog` → `data.roleProfiles`. The requested pair must exist. An unknown pair returns **422 `INVALID_CAREER_TARGET`**. Invalid grades, omitted `career_goal`, extra top-level properties and extra goal properties return **422 `VALIDATION_ERROR`**. Fields such as `skills`, `role`, `grade`, `employeeId`, or permissions cannot be changed through this endpoint.

The response is **200 `{ data: EmployeeDetail }`**, using the existing shared profile contract. Only `career_goal_json` is updated, in the same transaction as validation and deterministic recomputation. Current role/grade, assessed/effective skills, activity history and account permissions are preserved. Readiness may change because it now measures a different target; it is not a skill gain or loss.

```ts
import type { CareerGoalUpdate, EmployeeDetail } from "@/contracts/api";
import type { AuthSession } from "@/contracts/auth";

async function saveCareerGoal(
  session: AuthSession,
  employeeId: string,
  input: CareerGoalUpdate,
  signal: AbortSignal,
): Promise<EmployeeDetail> {
  const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/career-goal`, {
    method: "PATCH", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error.message), body.error, { status: response.status });
  return body.data;
}
```

Before saving, cancel pending AI requests and disable other conflicting mutations. Replace the profile with the returned data, clear the previous completion comparison, and request fresh AI explanations separately. Late explanations for the old career target must never replace the new view. On uncertain network failure, reload the profile before offering a retry.

## Imported employees and forecast

Individual account creation after import uses the existing HR endpoints; the exact contract is in [FRONTEND_ACCOUNTS_HANDOFF.md](FRONTEND_ACCOUNTS_HANDOFF.md). Shared demo login remains optional and is not proof of individual employee privacy.

An additional forecast field is awaiting agreement. Until its contract is confirmed, use the existing `expectedChanges` for skill previews and completion `progress` for measured readiness changes. Do not invent time-to-promotion or sum alternative recommendations as though they were a sequential plan.

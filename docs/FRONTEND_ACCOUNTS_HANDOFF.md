# Frontend: HR creates access for an imported employee

## Intended flow

1. HR signs in with an individual HR account.
2. HR imports the employee JSON through the existing `POST /api/import` flow. CSV history can be imported afterwards.
3. After import succeeds, show **Create employee access** for an existing employee ID. Creating an account is a separate action; importing a profile does not automatically create an individual login.
4. HR enters a username and password and confirms the employee binding.
5. Submit `POST /api/hr/accounts`, clear the password input on success, and refresh `GET /api/hr/accounts`.
6. The employee signs in with that username and password and receives access to their own profile. They cannot open other profiles or HR endpoints.

The account API always creates the `employee` role. There is no role selector in this form. `DEMO_EMPLOYEE_LOGIN=false` is the individual-account mode used by the integration tests; creating individual accounts does not require demo login.

## Session and request rules

- The browser sends the `cq_session` **HttpOnly** cookie automatically with `credentials: "same-origin"`. JavaScript must not read or store this cookie.
- Restore the current session with `GET /api/auth/session`. Its successful response is `{ data: AuthSession }`, with `data.user.role`, `data.user.employeeId`, `data.expiresAt`, and `data.csrfToken`.
- Show account administration only when the server session has `user.role === "hr"`. Backend authorization remains decisive.
- For `POST /api/hr/accounts`, send `X-CSRF-Token: session.csrfToken` and `Content-Type: application/json`. Browser requests must originate from the configured `APP_ORIGIN`.
- Use relative URLs and `cache: "no-store"`. Keep the session and CSRF token in memory, clear protected state on logout/401, and cancel pending requests when the session changes.
- Never persist the password in local storage, session storage, analytics, console output, or query parameters. GET responses cannot recover the password.

## `GET /api/hr/accounts`

Authorization: an authenticated HR session. No request body or query parameters are required.

Response: **200**.

```ts
interface AccountListResponse {
  data: {
    items: Array<{
      id: string;
      username: string;
      role: "employee" | "hr";
      employeeId: string | null;
      active: boolean;
    }>;
  };
}
```

The list includes HR accounts (`employeeId: null`) and employee accounts. It is sorted by username. No password, password hash, cookie token, or session hash is returned. `active` is informational: this endpoint does not provide an activation/deactivation mutation.

## `POST /api/hr/accounts`

Authorization: an authenticated HR session, correct Origin, and matching CSRF token.

The JSON body contains **exactly three fields**:

```ts
interface CreateEmployeeAccountInput {
  username: string;
  password: string;
  employeeId: string;
}
```

| Field | Backend validation |
| --- | --- |
| `username` | Trimmed; 3–80 characters; ASCII letters, digits, `_`, `.`, and `-` only; stored in lowercase; case-insensitive uniqueness. |
| `password` | 12–128 characters. Do not trim it in the frontend. |
| `employeeId` | Exact existing employee ID, 1–100 characters. Import the profile first. |

Additional properties, including `role`, `active`, and `id`, are rejected. Use `employeeId`, not the dataset field name `employee_id`.

Response: **201**.

```ts
interface CreateEmployeeAccountResponse {
  data: {
    id: string;
    username: string; // normalized lowercase username
    role: "employee";
    employeeId: string;
  };
}
```

The POST response has no `active` field; refresh the GET list to display account status. It neither signs in as the new employee nor changes the current HR session. Multiple usernames may be linked to one employee; uniqueness applies to username, not employee ID.

## Error handling

Errors use the existing envelope:

```ts
interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details: Array<{ file?: string; row?: number; field?: string; message: string }>;
  };
}
```

| HTTP | Code | Frontend response |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | Clear protected state and ask the user to sign in again. Applies to GET and POST. |
| 403 | `FORBIDDEN` | Account administration is HR-only. Hide the action and show the access error. |
| 403 | `CSRF_INVALID` | Refresh the session before the user retries. Do not retry account creation automatically. |
| 403 | `ORIGIN_FORBIDDEN` | Check the configured application origin. Do not bypass the server check. |
| 409 | `USERNAME_EXISTS` | Preserve the employee binding and ask for a different username. |
| 422 | `EMPLOYEE_NOT_FOUND` | The linked profile does not exist. Import it or choose an existing profile. |
| 422 | `VALIDATION_ERROR` | Show `details[].field` and `details[].message`; includes short/long passwords, invalid usernames, missing fields, and extra properties. |
| 400 | `INVALID_JSON` | The request body was not valid JSON. |
| 500 | `INTERNAL_ERROR` | Show a retryable failure; avoid displaying internal details. |

On a network failure after POST, success can be uncertain. Reload the account list to check whether the username was created before offering another submission. The endpoint does not accept an idempotency key.

## Fetch example

This example runs after the HR user has signed in. Values come from the form; no credentials are embedded in source code. The existing frontend transport can wrap the same requests with cancellation and a timeout.

```ts
import type { AuthSession, SessionUser } from "@/contracts/auth";

async function apiData<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Request failed"), {
      status: response.status,
      code: body.error?.code,
      details: body.error?.details ?? [],
    });
  }
  return body.data as T;
}

async function createEmployeeAccess(
  input: { username: string; password: string; employeeId: string },
  signal: AbortSignal,
) {
  const session = await apiData<AuthSession>(await fetch("/api/auth/session", {
    credentials: "same-origin", cache: "no-store", signal,
  }));
  if (session.user.role !== "hr") throw new Error("HR access is required");

  const created = await apiData<SessionUser>(await fetch("/api/hr/accounts", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({
      username: input.username.trim(),
      password: input.password,
      employeeId: input.employeeId,
    }),
  }));
  return created;
}

async function listEmployeeAccess(signal: AbortSignal) {
  return apiData<{ items: Array<SessionUser & { active: boolean }> }>(
    await fetch("/api/hr/accounts", {
      credentials: "same-origin", cache: "no-store", signal,
    }),
  );
}
```

## Frontend acceptance checklist

- HR can import a new profile, create its individual account, and see the account in the refreshed list.
- The selected employee ID remains visible while choosing the username; display the employee name for confirmation.
- Disable submission while pending, display validation errors inline, and clear the password after completion or closing the form.
- Employee accounts cannot see the account-management UI; a direct API request still returns 403.
- After HR signs out, signing in with the newly created account opens only the imported employee's profile.
- Reopening the application or restarting the server preserves both the profile and its account.
- Do not claim that a profile import created login access unless POST account creation actually succeeded.

Automated backend coverage: `tests/imported-account-access.test.ts`. Run only this suite with `npx vitest run tests/imported-account-access.test.ts --maxWorkers=1`.

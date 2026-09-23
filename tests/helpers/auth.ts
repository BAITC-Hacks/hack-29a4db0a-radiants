import { randomUUID } from "node:crypto";
import type { AuthSession, UserRole } from "@/contracts/auth";
import { createSession, createUser } from "@/server/auth";

export const TEST_PASSWORD = "Test-only-password-2026!";

export interface TestIdentity {
  session: AuthSession;
  token: string;
}

/** Real persisted sessions: route tests exercise the same authorization as production. */
export async function testIdentity(role: UserRole = "hr", employeeId?: string): Promise<TestIdentity> {
  const user = await createUser({
    username: `test-${randomUUID()}`,
    password: TEST_PASSWORD,
    role,
    employeeId: employeeId ?? null,
  });
  return createSession(user);
}

export function authHeaders(identity: TestIdentity, extras?: HeadersInit): Headers {
  const headers = new Headers(extras);
  headers.set("Cookie", `cq_session=${identity.token}`);
  headers.set("Origin", "http://localhost");
  headers.set("X-CSRF-Token", identity.session.csrfToken);
  return headers;
}

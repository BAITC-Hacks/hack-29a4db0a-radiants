import { assertMutation, authenticate, audit, clearSessionCookie, logout } from "@/server/auth";
import { apiError, apiSuccess } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  try {
    const session = authenticate(request);
    assertMutation(request, session);
    logout(request);
    audit(session.user.id, "session.logout");
    const response = apiSuccess({ signedOut: true });
    clearSessionCookie(response);
    return response;
  } catch (error) { return apiError(error); }
}

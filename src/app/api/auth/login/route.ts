import { assertOrigin, login, loginSchema, logout, setSessionCookie } from "@/server/auth";
import { apiError, apiSuccess, readJsonBody } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const body = loginSchema.parse(await readJsonBody(request));
    const result = login(body.username, body.password, undefined, body.employeeId);
    if ("kind" in result) return apiSuccess(result);
    const { session, token } = result;
    logout(request);
    const response = apiSuccess(session);
    setSessionCookie(response, token, session.expiresAt);
    return response;
  } catch (error) { return apiError(error); }
}

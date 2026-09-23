import { accountSchema, assertMutation, authenticate, audit, createUser, listAccounts, requireHr } from "@/server/auth";
import { apiError, apiSuccess, readJsonBody } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try { requireHr(authenticate(request)); return apiSuccess({ items: listAccounts() }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const session = authenticate(request);
    requireHr(session);
    assertMutation(request, session);
    const input = accountSchema.parse(await readJsonBody(request));
    const user = createUser({ ...input, role: "employee" });
    audit(session.user.id, "account.created", user.id);
    return apiSuccess(user, 201);
  } catch (error) { return apiError(error); }
}

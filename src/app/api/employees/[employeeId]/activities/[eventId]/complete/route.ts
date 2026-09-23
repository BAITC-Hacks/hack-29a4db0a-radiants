import { completeActivitySchema } from "@/contracts/schemas";
import { apiError, apiSuccess, readJsonBody } from "@/server/http";
import { completeActivity } from "@/server/services/career-quest";
import { authenticate, assertMutation, requireSelf } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ employeeId: string; eventId: string }> },
) {
  try {
    const session = authenticate(request);
    assertMutation(request, session);
    const { employeeId, eventId } = await context.params;
    requireSelf(session, employeeId);
    const body = completeActivitySchema.parse(await readJsonBody(request));
    const result = await completeActivity(employeeId, eventId, body, undefined, session.user.id);
    return apiSuccess(result, 201);
  } catch (error) {
    return apiError(error);
  }
}

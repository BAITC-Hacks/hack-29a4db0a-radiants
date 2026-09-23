import { careerGoalUpdateSchema } from "@/contracts/schemas";
import { assertMutation, authenticate, requireSelf } from "@/server/auth";
import { apiError, apiSuccess, readJsonBody } from "@/server/http";
import { updateCareerGoal } from "@/server/services/career-quest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ employeeId: string }> }) {
  try {
    const session = authenticate(request);
    assertMutation(request, session);
    const { employeeId } = await context.params;
    requireSelf(session, employeeId);
    const values = careerGoalUpdateSchema.parse(await readJsonBody(request));
    const view = updateCareerGoal(employeeId, values, undefined, session.user.id);
    return apiSuccess(view);
  } catch (error) { return apiError(error); }
}

import { apiError, apiSuccess } from "@/server/http";
import { getEmployeeProjection } from "@/server/services/career-quest";
import { authenticate, requireEmployeeAccess } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  try {
    const session = authenticate(request);
    const { employeeId } = await context.params;
    requireEmployeeAccess(session, employeeId);
    return apiSuccess(getEmployeeProjection(employeeId));
  } catch (error) {
    return apiError(error);
  }
}

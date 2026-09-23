import { apiError, apiSuccess } from "@/server/http";
import { AI_REQUEST_BUDGET_MS, getRecommendations } from "@/server/services/career-quest";
import { authenticate, requireEmployeeAccess } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  const deadline = performance.now() + AI_REQUEST_BUDGET_MS;
  try {
    const session = authenticate(request);
    const { employeeId } = await context.params;
    requireEmployeeAccess(session, employeeId);
    const response = apiSuccess(await getRecommendations(employeeId, undefined, undefined, deadline));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

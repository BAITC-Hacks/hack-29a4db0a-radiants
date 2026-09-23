import { apiError, apiSuccess } from "@/server/http";
import { AI_REQUEST_BUDGET_MS, getRecommendations } from "@/server/services/career-quest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  const deadline = performance.now() + AI_REQUEST_BUDGET_MS;
  try {
    const { employeeId } = await context.params;
    const response = apiSuccess(await getRecommendations(employeeId, undefined, undefined, deadline));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

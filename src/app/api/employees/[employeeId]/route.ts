import { apiError, apiSuccess } from "@/server/http";
import { getEmployeeProjection } from "@/server/services/career-quest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  try {
    const { employeeId } = await context.params;
    return apiSuccess(getEmployeeProjection(employeeId));
  } catch (error) {
    return apiError(error);
  }
}

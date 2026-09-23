import { completeActivitySchema } from "@/contracts/schemas";
import { apiError, apiSuccess, readJsonBody } from "@/server/http";
import { completeActivity } from "@/server/services/career-quest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ employeeId: string; eventId: string }> },
) {
  try {
    const { employeeId, eventId } = await context.params;
    const body = completeActivitySchema.parse(await readJsonBody(request));
    return apiSuccess(await completeActivity(employeeId, eventId, body), 201);
  } catch (error) {
    return apiError(error);
  }
}

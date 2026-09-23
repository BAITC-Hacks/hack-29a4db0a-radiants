import { apiError, apiSuccess } from "@/server/http";
import { getCatalog } from "@/server/services/career-quest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try { return apiSuccess(getCatalog()); }
  catch (error) { return apiError(error); }
}

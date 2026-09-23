import { authenticate } from "@/server/auth";
import { apiError, apiSuccess } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try { return apiSuccess(authenticate(request)); }
  catch (error) { return apiError(error); }
}

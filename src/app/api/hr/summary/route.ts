import type { NextRequest } from "next/server";
import { hrQuerySchema } from "@/contracts/schemas";
import { apiError, apiSuccess } from "@/server/http";
import { getHrSummary } from "@/server/services/career-quest";
import { authenticate, requireHr } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    requireHr(authenticate(request));
    const filters = hrQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(getHrSummary(filters));
  } catch (error) {
    return apiError(error);
  }
}

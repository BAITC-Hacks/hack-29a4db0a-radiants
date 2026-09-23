import type { NextRequest } from "next/server";
import { hrQuerySchema } from "@/contracts/schemas";
import { apiError, apiSuccess } from "@/server/http";
import { getHrSummary } from "@/server/services/career-quest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const filters = hrQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(getHrSummary(filters));
  } catch (error) {
    return apiError(error);
  }
}

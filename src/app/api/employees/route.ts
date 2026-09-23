import type { NextRequest } from "next/server";
import { employeeListQuerySchema } from "@/contracts/schemas";
import { apiError, apiSuccess } from "@/server/http";
import { listEmployees } from "@/server/services/career-quest";
import { authenticate } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const session = authenticate(request);
    const query = employeeListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const items = listEmployees(query).filter((item) => session.user.role === "hr" || item.employeeId === session.user.employeeId);
    return apiSuccess({ items, total: items.length });
  } catch (error) {
    return apiError(error);
  }
}

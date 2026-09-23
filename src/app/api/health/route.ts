import { SCHEMA_VERSION, databaseCounts, getDatabase } from "@/server/db/database";
import { apiError, apiSuccess } from "@/server/http";
import { ensureAuthBootstrap } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = getDatabase();
    ensureAuthBootstrap(db);
    return apiSuccess({
      status: "ok" as const,
      schemaVersion: SCHEMA_VERSION,
      counts: databaseCounts(db),
    });
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiError, ApiSuccess } from "@/contracts/api";
import { AppError, zodDetails } from "@/server/errors";

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must contain valid JSON");
  }
}

export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, { status });
}

export function apiError(error: unknown): NextResponse<ApiError> {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: zodDetails(error),
        },
      },
      { status: 422 },
    );
  }
  console.error(error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected server error occurred",
        details: [],
      },
    },
    { status: 500 },
  );
}

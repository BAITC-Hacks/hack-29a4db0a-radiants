import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiError, ApiSuccess } from "@/contracts/api";
import { AppError, zodDetails } from "@/server/errors";

export async function readLimitedBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const tooLarge = () => new AppError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`);
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body.buffer;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 64 * 1024)));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_JSON", "Request body must contain valid JSON");
  }
}

export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
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
      { status: error.status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } },
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
      { status: 422, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } },
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
    { status: 500, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } },
  );
}

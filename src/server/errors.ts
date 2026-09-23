import { ZodError } from "zod";
import type { ApiErrorDetail } from "@/contracts/api";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function zodDetails(error: ZodError, file?: string): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    file,
    field: issue.path.join("."),
    message: issue.message,
  }));
}

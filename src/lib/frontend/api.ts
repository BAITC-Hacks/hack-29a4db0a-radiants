import type { ApiError, ApiSuccess } from "@/contracts/api";

export async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json() as ApiSuccess<T> | ApiError;
  if (!response.ok || "error" in body) {
    if ("error" in body) {
      const details = body.error.details.map((item) => [item.file, item.row && `row ${item.row}`, item.field, item.message].filter(Boolean).join(": ")).join("; ");
      throw new Error(details || body.error.message);
    }
    throw new Error(`Request failed (${response.status})`);
  }
  return body.data;
}

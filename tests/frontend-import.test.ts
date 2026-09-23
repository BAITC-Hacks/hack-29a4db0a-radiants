import { describe, expect, it, vi } from "vitest";
import { createCareerApi } from "../src/lib/frontend/api";

describe("frontend import transport (normalization belongs to the backend)", () => {
  it("uploads the original JSON file without reading or parsing it", async () => {
    const file = new File(["not JSON — backend must validate it"], "employees.json", { type: "application/json" });
    const read = vi.spyOn(file, "text").mockRejectedValue(new Error("The UI must not read files"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "Malformed employee JSON" }), { status: 422 }));
    await expect(createCareerApi({ fetcher }).importData(file)).rejects.toMatchObject({ status: 422 });
    expect(read).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/import");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("employees")).toBe(file);
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });
  it("uploads CSV and returns imported ids and duplicate-history warnings unchanged", async () => {
    const result = { employeeIds: ["EMP-NEW"], warnings: ["Duplicate record R-1 skipped."] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
    expect(await createCareerApi({ fetcher }).importData(new File(["raw,csv"], "history.CSV"))).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts an empty successful response so the caller can refresh employees", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await createCareerApi({ fetcher }).importData(new File(["[]"], "employees.json"))).toEqual({ success: true });
  });
  it("rejects unsupported extensions without sending a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createCareerApi({ fetcher }).importData(new File(["text"], "profile.exe"))).rejects.toThrow("JSON или CSV");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

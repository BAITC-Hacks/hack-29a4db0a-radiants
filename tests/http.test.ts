import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonBody, readLimitedBody } from "@/server/http";
import { closeDatabase, databaseCounts } from "@/server/db/database";
import { POST as completionRoute } from "@/app/api/employees/[employeeId]/activities/[eventId]/complete/route";
import { POST as importRoute } from "@/app/api/import/route";
import { authHeaders, testIdentity, type TestIdentity } from "./helpers/auth";

const JSON_LIMIT = 64 * 1024;
const IMPORT_LIMIT = 10 * 1024 * 1024;
const completionContext = { params: Promise.resolve({ employeeId: "E0178", eventId: "EV_005" }) };

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit) {
  let index = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half", headers };
  return { request: new Request("http://localhost/api/test", init), cancel };
}

describe("bounded request body parsing", () => {
  it("accepts valid JSON exactly at the 64 KiB limit", async () => {
    const value = "x".repeat(JSON_LIMIT - 2);
    const body = JSON.stringify(value);
    expect(new TextEncoder().encode(body).length).toBe(JSON_LIMIT);
    expect(await readJsonBody(new Request("http://localhost", { method: "POST", body }))).toBe(value);
  });

  it("rejects oversized declared content before reading the stream", async () => {
    const { request } = streamedRequest([new TextEncoder().encode("{}")], { "Content-Length": String(JSON_LIMIT + 1) });
    const reader = vi.spyOn(request.body!, "getReader");
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(reader).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it("counts actual streamed bytes without Content-Length and cancels when the limit is exceeded", async () => {
    const { request, cancel } = streamedRequest([new Uint8Array(JSON_LIMIT), new Uint8Array(1), new Uint8Array(100)]);
    expect(request.headers.has("content-length")).toBe(false);
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request.body!.locked).toBe(false);
  });

  it("does not trust an understated Content-Length", async () => {
    const { request } = streamedRequest([new Uint8Array(JSON_LIMIT + 1)], { "Content-Length": "2" });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("counts UTF-8 bytes and retains the structured invalid-JSON error below the limit", async () => {
    const body = JSON.stringify("я".repeat(JSON_LIMIT / 2));
    await expect(readJsonBody(new Request("http://localhost", { method: "POST", body })))
      .rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    await expect(readJsonBody(new Request("http://localhost", { method: "POST", body: "{" })))
      .rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
    expect((await readLimitedBody(new Request("http://localhost"), 100)).byteLength).toBe(0);
  });
});

describe("HTTP limits after authorization", () => {
  let directory: string;
  let employee: TestIdentity;
  let hr: TestIdentity;

  beforeEach(async () => {
    closeDatabase();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-http-test-"));
    vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "limits.sqlite"));
    vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("APP_ORIGIN", "http://localhost");
    employee = await testIdentity("employee", "E0178");
    hr = await testIdentity("hr");
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("returns a 413 JSON envelope for oversized completion and leaves history unchanged", async () => {
    const counts = databaseCounts();
    for (const declared of [false, true]) {
      const headers = authHeaders(employee, { "Content-Type": "application/json" });
      if (declared) headers.set("Content-Length", String(JSON_LIMIT + 1));
      const { request } = streamedRequest([new Uint8Array(declared ? 2 : JSON_LIMIT + 1)], headers);
      const response = await completionRoute(request, completionContext);
      expect(response.status).toBe(413);
      expect((await response.json()).error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", details: [] });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(databaseCounts()).toEqual(counts);
    }
  });

  it("limits multipart import to 10 MiB for both declared and actual streamed payloads", async () => {
    const counts = databaseCounts();
    for (const declared of [false, true]) {
      const headers = authHeaders(hr, { "Content-Type": "multipart/form-data; boundary=limit-test" });
      if (declared) headers.set("Content-Length", String(IMPORT_LIMIT + 1));
      const { request } = streamedRequest([new Uint8Array(declared ? 2 : IMPORT_LIMIT + 1)], headers);
      const response = await importRoute(request);
      expect(response.status).toBe(413);
      expect((await response.json()).error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", details: [] });
      expect(databaseCounts()).toEqual(counts);
    }
  });

  it("rejects unauthenticated or unauthorized requests before reading oversized bodies", async () => {
    const counts = databaseCounts();
    const inputs = [
      { identity: undefined, route: "completion", status: 401 },
      { identity: hr, route: "completion", status: 403 },
      { identity: undefined, route: "import", status: 401 },
      { identity: employee, route: "import", status: 403 },
    ] as const;
    for (const { identity, route, status } of inputs) {
      const headers = identity ? authHeaders(identity) : new Headers();
      headers.set("Content-Length", String(IMPORT_LIMIT + 1));
      headers.set("Content-Type", route === "completion" ? "application/json" : "multipart/form-data; boundary=limit-test");
      const { request } = streamedRequest([new Uint8Array(16)], headers);
      const reader = vi.spyOn(request.body!, "getReader");
      const response = route === "completion" ? await completionRoute(request, completionContext) : await importRoute(request);
      expect(response.status).toBe(status);
      expect(reader).not.toHaveBeenCalled();
      expect(request.bodyUsed).toBe(false);
    }
    expect(databaseCounts()).toEqual(counts);
  });
});

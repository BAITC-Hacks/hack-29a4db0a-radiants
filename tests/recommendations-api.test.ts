import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecommendationsHandler, type RecommendationServerOptions } from "../src/server/recommendations";
import { demoDataset } from "../src/lib/frontend/demo-data";
import { normalizeDataset } from "../src/lib/data/normalize";
import { getEmployeeView } from "../src/lib/recommendation";
import type { RecommendationResponse } from "../src/lib/ai/api-contract";

let server: Server | undefined;
async function start(options: RecommendationServerOptions = {}) {
  server = createServer(createRecommendationsHandler(options));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return `http://127.0.0.1:${address.port}/api/recommendations`;
}

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

const payload = () => ({ employeeId: "EMP-014", dataset: structuredClone(demoDataset) });
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/recommendations", () => {
  it("calls OpenAI on the server and returns validated AI text without exposing credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      expect(options?.headers).toMatchObject({ Authorization: "Bearer test-server-secret" });
      const request = JSON.parse(String(options?.body));
      const evidence = JSON.parse(request.input[1].content);
      expect(evidence.employee).toBeUndefined();
      expect(evidence.recommendations.map((rec: { eventId: string }) => rec.eventId)).toEqual(["EV_DEMO_01"]);
      return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{
        type: "output_text", text: JSON.stringify({ recommendations: [{
          eventId: "EV_DEMO_01", explanation: "System design closes the Senior gap, with no recent negative workshop history.",
          evidenceRefs: ["target", "history", "skill:SK_SYS"],
        }] }),
      }] }] }));
    });
    const response = await post(await start({ apiKey: "test-server-secret", fetchImpl }), payload());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("test-server-secret");
    const result = JSON.parse(text) as RecommendationResponse;
    expect(result.aiStatus).toBe("llm");
    const baseline = getEmployeeView(normalizeDataset(demoDataset), "EMP-014");
    expect(result.view.recommendations[0]).toEqual({ ...baseline.recommendations[0],
      explanationSource: "llm", aiExplanation: "System design closes the Senior gap, with no recent negative workshop history.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports missing configuration honestly and does not make a paid request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await post(await start({ fetchImpl }), payload());
    const result = await response.json() as RecommendationResponse;
    expect(result.aiStatus).toBe("not_configured");
    expect(result.view.recommendations[0]?.explanationSource).toBe("fallback");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns HTTP 200 with visible fallback when the upstream times out", async () => {
    const response = await post(await start({ apiKey: "test", timeoutMs: 20, fetchImpl: () => new Promise(() => {}) }), payload());
    expect(response.status).toBe(200);
    const result = await response.json() as RecommendationResponse;
    expect(result.aiStatus).toBe("unavailable");
    expect(result.view.recommendations[0]?.explanationSource).toBe("fallback");
  });

  it("recomputes completed activities before AI and skips AI when the gaps are closed", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const input = payload();
    input.dataset.history.push({ record_id: "NEW_COMPLETION", employee_id: "EMP-014", event_id: "EV_DEMO_01", date: "2026-10-01", due_date: null, status: "completed", completion_pct: 100, score: null, feedback_rating: null, assigned_by: "self" });
    const response = await post(await start({ apiKey: "test", fetchImpl }), input);
    const result = await response.json() as RecommendationResponse;
    expect(result.aiStatus).toBe("not_needed");
    expect(result.view.readiness).toBe(100);
    expect(result.view.recommendations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid input before any AI request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const url = await start({ apiKey: "test", fetchImpl });
    expect((await post(url, null)).status).toBe(400);
    expect((await post(url, { ...payload(), employeeId: "UNKNOWN" })).status).toBe(404);
    const malformed = payload();
    malformed.dataset.history[0]!.date = "2026-02-30";
    expect((await post(url, malformed)).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" })).status).toBe(400);
    expect((await fetch(url)).status).toBe(405);
    expect((await fetch(url, { method: "POST", body: "text" })).status).toBe(415);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies", async () => {
    const response = await post(await start(), { data: "x".repeat(2 * 1024 * 1024) });
    expect(response.status).toBe(413);
  });
});

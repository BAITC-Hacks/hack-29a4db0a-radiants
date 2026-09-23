import type { IncomingMessage, ServerResponse } from "node:http";
import { adaptStarterDataset } from "../lib/data/starter-dataset";
import { normalizeDataset } from "../lib/data/normalize";
import { getEmployeeView } from "../lib/recommendation";
import { applyAiExplanations } from "../lib/ai/explanations";
import { createOpenAIExplainer } from "../lib/ai/openai-explainer";
import type { RecommendationResponse } from "../lib/ai/api-contract";

export interface RecommendationServerOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function createRecommendationsHandler(options: RecommendationServerOptions) {
  const explainer = createOpenAIExplainer(options);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        throw new RequestError("Use POST for recommendations", 405);
      }
      if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        throw new RequestError("Expected application/json", 415);
      }
      const body = await readBody(req);
      if (!isObject(body) || typeof body.employeeId !== "string" || !isObject(body.dataset)) {
        throw new RequestError("Expected employeeId and dataset", 400);
      }
      let dataset;
      try {
        dataset = adaptStarterDataset({
          employeesFile: { employees: body.dataset.employees },
          eventsFile: { events: body.dataset.events },
          skillsFile: { skills: body.dataset.skills, role_profiles: body.dataset.roleProfiles },
          historyRows: body.dataset.history,
        });
      } catch (error) {
        throw new RequestError(error instanceof Error ? error.message : "Invalid dataset", 400);
      }
      const normalized = normalizeDataset(dataset);
      if (!normalized.employeeById.has(body.employeeId)) throw new RequestError("Unknown employee", 404);
      const baseline = getEmployeeView(normalized, body.employeeId);
      let response: RecommendationResponse;
      if (!baseline.recommendations.length) {
        response = { view: baseline, aiStatus: "not_needed" };
      } else if (!options.apiKey?.trim()) {
        response = { view: baseline, aiStatus: "not_configured" };
      } else {
        const view = await applyAiExplanations(baseline, explainer);
        const explained = view.recommendations.filter((rec) => rec.explanationSource === "llm").length;
        response = { view, aiStatus: explained === view.recommendations.length ? "llm" : explained ? "partial" : "unavailable" };
      }
      res.end(JSON.stringify(response));
    } catch (error) {
      res.statusCode = error instanceof RequestError ? error.status : 500;
      res.end(JSON.stringify({ error: error instanceof RequestError ? error.message : "Recommendation service failed" }));
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const limit = 2 * 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= limit) chunks.push(chunk);
    });
    req.once("error", reject);
    req.once("aborted", () => reject(new RequestError("Request aborted", 400)));
    req.once("end", () => {
      if (bytes > limit) { reject(new RequestError("Dataset exceeds 2 MB request limit", 413)); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new RequestError("Invalid JSON body", 400)); }
    });
  });
}

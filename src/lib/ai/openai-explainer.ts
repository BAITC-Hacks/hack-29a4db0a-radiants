import type { RecommendationExplainer, AiExplanation } from "./explanations";

interface OpenAIExplainerOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenAIResponsePayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

export function createOpenAIExplainer(options: OpenAIExplainerOptions): RecommendationExplainer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "gpt-6-astra";
  const timeoutMs = options.timeoutMs ?? 8_000;

  return {
    async explain(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            input: [
              {
                role: "system",
                content:
                  "Explain only the supplied Career Quest recommendations. Return JSON. Do not select new events, invent evidence, or make promotion guarantees.",
              },
              {
                role: "user",
                content: JSON.stringify(input),
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "career_recommendation_explanations",
                strict: true,
                schema: explanationSchema,
              },
            },
          }),
        });
        if (!response.ok) {
          throw new Error(`OpenAI request failed: ${response.status}`);
        }

        const payload = (await response.json()) as OpenAIResponsePayload;
        const outputText = extractOutputText(payload);
        if (!outputText) {
          throw new Error("OpenAI response did not include structured text");
        }
        return parseAiExplanations(outputText);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

const explanationSchema = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          eventId: { type: "string" },
          explanation: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["eventId", "explanation", "evidenceRefs"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
} as const;

function extractOutputText(payload: OpenAIResponsePayload): string | undefined {
  if (payload.output_text) {
    return payload.output_text;
  }
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;
}

function parseAiExplanations(outputText: string): AiExplanation[] {
  const parsed: unknown = JSON.parse(outputText);
  if (!isExplanationEnvelope(parsed)) {
    throw new Error("OpenAI response did not match the explanation contract");
  }
  return parsed.recommendations;
}

function isExplanationEnvelope(value: unknown): value is { recommendations: AiExplanation[] } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { recommendations?: unknown }).recommendations)) {
    return false;
  }
  return (value as { recommendations: unknown[] }).recommendations.every(
    (item) =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as AiExplanation).eventId === "string" &&
      typeof (item as AiExplanation).explanation === "string" &&
      Array.isArray((item as AiExplanation).evidenceRefs) &&
      (item as AiExplanation).evidenceRefs.every((ref) => typeof ref === "string"),
  );
}

import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRecommendationsHandler } from "./src/server/recommendations";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "OPENAI_");
  const handler = createRecommendationsHandler({
    apiKey: process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? env.OPENAI_MODEL,
  });
  const api: Plugin = {
    name: "career-quest-recommendation-api",
    configureServer(server) { server.middlewares.use("/api/recommendations", handler); },
    configurePreviewServer(server) { server.middlewares.use("/api/recommendations", handler); },
  };
  return { plugins: [react(), api] };
});

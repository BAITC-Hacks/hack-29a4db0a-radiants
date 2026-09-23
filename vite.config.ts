import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: env.CAREER_API_TARGET ? { proxy: { "/api": env.CAREER_API_TARGET } } : undefined,
  };
});

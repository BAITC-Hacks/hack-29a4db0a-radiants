import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // SQLite fixtures and password derivation are memory intensive on demo laptops.
    maxWorkers: 2,
    include: ["tests/**/*.test.ts"],
    sequence: { concurrent: false },
  },
});

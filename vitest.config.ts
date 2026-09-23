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
    // SQLite fixtures and password derivation compete for CPU on demo laptops.
    // Run files serially so setup and login checks keep their existing time limits.
    maxWorkers: 1,
    include: ["tests/**/*.test.ts"],
    sequence: { concurrent: false },
  },
});

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
    // Run files serially; allow fixture creation/cleanup on slow Docker Desktop
    // disks. API/AI deadline assertions and explicit live-test limits stay intact.
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    sequence: { concurrent: false },
  },
});

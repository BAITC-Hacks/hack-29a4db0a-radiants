import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/employees/[employeeId]/activities/[eventId]/complete/route";
import { closeDatabase, databaseCounts, getDatabase } from "@/server/db/database";
import { getEmployeeProjection } from "@/server/services/career-quest";
import { normalizeDataset } from "@/lib/data/normalize";
import { previewActivityCompletion } from "@/lib/recommendation/completion";
import { loadDomainDataset } from "@/server/repositories";
import { authHeaders, testIdentity } from "./helpers/auth";

let directory: string;

beforeEach(() => {
  closeDatabase();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "career-completion-policy-"));
  vi.stubEnv("CAREER_QUEST_DB_PATH", path.join(directory, "test.sqlite"));
  vi.stubEnv("CAREER_QUEST_DATA_DIR", path.resolve("data"));
  vi.stubEnv("APP_ORIGIN", "http://localhost");
});

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

it("rejects E0178 / EV_006 before prerequisites are met, without writing history or progress", async () => {
  const identity = await testIdentity("employee", "E0178");
  const db = getDatabase();
  const before = getEmployeeProjection("E0178", db);
  const counts = databaseCounts(db);
  expect(before.effectiveSkills.SK_SYSTEM_DESIGN).toBe(1);
  expect(before.recommendationDiagnostics.blockedEvents.find((event) => event.eventId === "EV_006")?.reasons)
    .toContainEqual(expect.objectContaining({ code: "prerequisites" }));

  const response = await POST(new Request("http://localhost/api/employees/E0178/activities/EV_006/complete", {
    method: "POST", headers: authHeaders(identity), body: "{}",
  }), { params: Promise.resolve({ employeeId: "E0178", eventId: "EV_006" }) });

  expect.soft(response.status).toBe(422);
  expect.soft(databaseCounts(db)).toEqual(counts);
  const after = getEmployeeProjection("E0178", db);
  expect.soft(after.effectiveSkills).toEqual(before.effectiveSkills);
  expect.soft(after.readiness).toBe(before.readiness);
});

it("matches the actual authorized SQLite completion to the independent single-event preview", async () => {
  const identity = await testIdentity("employee", "E0178");
  const db = getDatabase();
  const source = loadDomainDataset(db);
  const result = previewActivityCompletion(normalizeDataset(source), "E0178", "EV_005");
  expect(result.allowed).toBe(true);
  if (!result.allowed) throw new Error("Expected an allowed completion");
  const response = await POST(new Request("http://localhost/api/employees/E0178/activities/EV_005/complete", {
    method: "POST", headers: authHeaders(identity), body: "{}",
  }), { params: Promise.resolve({ employeeId: "E0178", eventId: "EV_005" }) });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.data.activity.date).toBe(result.completedAt);
  expect(body.data.view.effectiveSkills).toEqual(result.preview.effectiveSkills);
  expect(body.data.view.skillGaps).toEqual(result.preview.skillGaps);
  expect(body.data.progress).toEqual(result.preview.progress);
  expect(databaseCounts(db).activityHistory).toBe(2744);
  expect(loadDomainDataset(db).employees).toEqual(source.employees);
});

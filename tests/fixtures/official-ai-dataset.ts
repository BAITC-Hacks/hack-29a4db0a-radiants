import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { adaptStarterDataset } from "../../src/lib/data/starter-dataset";

/** Test-only filesystem loader; never part of the pure AI/domain modules. */
export function officialAiDataset() {
  const json = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
  return adaptStarterDataset({
    employeesFile: json("data/employees.json"), eventsFile: json("data/events.json"),
    skillsFile: json("data/skills.json"),
    historyRows: parse(fs.readFileSync("data/activity_history.csv", "utf8"), { columns: true, skip_empty_lines: true, bom: true }),
  });
}

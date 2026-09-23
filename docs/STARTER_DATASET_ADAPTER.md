# Official dataset adapter

## Backend handoff

Import `adaptStarterDataset` from `src/lib/data/starter-dataset.ts`. It accepts four named values and returns a new `CareerDataset`:

| Input | Expected value | Output |
| --- | --- | --- |
| `employeesFile` | Decoded JSON object with `employees` array | `employees` |
| `eventsFile` | Decoded JSON object with `events` array | `events` |
| `skillsFile` | Decoded JSON object with `skills` and `role_profiles` arrays | `skills`, `roleProfiles` |
| `historyRows` | CSV-parser output: array of row objects keyed by column headers | `history` |

The function does not read files, parse CSV text, persist data, or call an API. Backend owns these operations. Use a CSV parser that handles quoting and BOM headers. Then pass the returned dataset to `normalizeDataset`, `getEmployeeView`, and `buildHrSummary`. No framework, dependency, or public domain type changes are required.

Each call builds a detached dataset with exactly the supplied arrays. It does not append demo events or skills and does not mutate its input. When replacing a whole dataset, store this return value directly instead of passing it through the frontend's partial-merge path.

## Conversion and validation

- JSON records are checked against the existing domain fields: grades, skill levels, event formats, audience, effects, and real calendar dates in `YYYY-MM-DD` format.
- History `completion_pct` and `score` are integers from 0 to 100; `feedback_rating` is an integer from 1 to 5. Numeric CSV strings and already-parsed numbers are accepted. Booleans, non-finite numbers, malformed numeric strings, fractions, and out-of-range values are rejected.
- Empty, whitespace, missing, or null `score`, `feedback_rating`, and `due_date` cells become null. Numeric zero is preserved. Required history fields, including `date` and `completion_pct`, are not silently defaulted.
- Unknown participation statuses, duplicate entity/record IDs, duplicate effects for a skill within an event, unknown referenced skills/employees/events, and missing target role profiles are rejected. A critical skill must have a corresponding role requirement.
- Skill IDs and role names are not hardcoded. A missing employee skill remains absent and the engine treats it as 0. A Lead without a goal is valid. Manager IDs may reference a manager outside the imported employee batch.
- Metadata and proficiency-scale descriptions do not override the engine's fixed snapshot date `2026-10-01`.

Errors are ordinary `Error` instances with field locations, for example `historyRows[2].date: expected a valid YYYY-MM-DD date`. Row indices are zero-based data-row indices, excluding the CSV header. Catch errors before replacing persisted state and return an import error to the UI.

For additional history, `parseActivityHistoryRows(rows)` performs conversion, field validation, and duplicate checks within that batch. It does not validate references against an existing catalog or merge records. Backend must define merge/update semantics and validate the combined dataset before saving; the full adapter can validate combined arrays wrapped in the same input shape above. Do not require every manager to be included in a small jury-profile import.

## Verification

The adapter's 23 regression cases cover wrapper mapping, independent output objects, null/zero conversion, invalid dates/numbers/statuses, duplicate IDs, missing references, empty employee batches, and Lead behavior. On the current frontend-integrated base, the full suite contains 46 passing tests.

The real starter CSV was parsed with PowerShell `Import-Csv`, then all four inputs were passed through the adapter. Result: exactly **200 employees, 40 events, 60 skills, 32 role profiles, and 2,743 history records**, without demo entries. All 200 employee views and HR aggregates computed successfully: 190 active targets, 173 employees with recommendations, and 27 without recommendations.

For each of the 173 first recommendations, an independent appended completion increased readiness; no existing skill decreased, and the predicted skill levels matched the reconstructed result. HR participation covers all 40 activities.

These checks exercise the adapter and engine. Wiring the browser importer or server endpoints, persistence, and a real OpenAI explanation remains integration work.

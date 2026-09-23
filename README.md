# Career Quest

Career Quest is a full-stack employee development navigator for the HackAlem AI / Halyk Bank case. The current implementation provides the backend foundation, deterministic recommendations, SQLite persistence, import support, HR analytics, and Docker startup. The product UI can consume the documented API without direct database access.

## Quick start with Docker

Requirements: Docker with Docker Compose.

```bash
docker compose up --build
```

Open `http://localhost:3000`. The first health request creates `.data/career-quest.sqlite`, applies the schema, and idempotently loads the starter dataset.

Stop the application:

```bash
docker compose down
```

Reset the persisted demo database:

```bash
docker compose down -v
```

The reset command deletes the Docker volume and is intentionally separate from normal startup.

## Local development

Requirements: Node.js 22 or newer (`better-sqlite3` requires it). Docker includes Node.js 22 and the native build tools. Local installation may need the platform C++ build tools if a prebuilt SQLite binary is unavailable.

```bash
npm ci
npm run dev
```

Useful commands:

```bash
npm run build
npm test
```

Copy `.env.example` to `.env.local` only when overriding default paths or enabling a future AI provider. `OPENAI_API_KEY` is optional; the current application works without it.

## Architecture

```text
JSON/CSV starter data
  -> Zod validation and SQLite seed
  -> repositories
  -> deterministic domain service
  -> route handlers
  -> frontend
```

- `src/contracts` owns public DTOs and validation schemas.
- `src/server` owns SQLite, repositories, imports, transactions, and HTTP errors.
- `src/domain` owns deterministic projection, eligibility, ranking, and HR calculations.
- `src/ai` contains the provider seam. The current enhancer is deterministic.
- `src/app/api` exposes the backend to the product UI.

The fixed dataset snapshot date is `2026-10-01`. Machine time is not used for event availability.

## API

All successful responses use `{ "data": ... }`. Errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Readable description",
    "details": []
  }
}
```

### Health and employees

- `GET /api/health`
- `GET /api/employees?search=&role=&grade=&department=`
- `GET /api/employees/:employeeId`
- `GET /api/employees/:employeeId/recommendations`

### Complete an activity

`POST /api/employees/:employeeId/activities/:eventId/complete`

```json
{
  "completedAt": "2026-10-20",
  "score": 90,
  "feedbackRating": 5
}
```

For a self-paced activity, the default completion date is the snapshot date. For a scheduled activity, it is the nearest future session. Non-repeatable completed activities return HTTP 409; `EV_036` may repeat.

### Import hidden evaluation data

`POST /api/import` accepts `multipart/form-data`:

- `employees`: official wrapper, one employee, or an employee array as JSON;
- `history`: CSV using the official activity-history columns.

The operation is transactional. Unknown references or any invalid row return HTTP 422 without partial writes. Existing employees are updated; repeated history `record_id` values are skipped.

### HR analytics

`GET /api/hr/summary?role=&grade=&department=` returns common gaps, people without targets or recommendations, participation statuses, assignment sources, event completion rates, and the filtered population.

## Recommendation boundaries

The deterministic layer owns exact business rules:

- effective skills include completions after `last_review_date` and respect `max_level`;
- a valid career goal wins, otherwise the next grade is used;
- Leads without a valid target return `no_target`;
- mandatory, unavailable, prerequisite-blocked, already completed, and in-progress activities are excluded;
- `EV_036` is repeatable;
- critical target gaps receive more weight;
- recent completions and negative participation patterns adjust suitability;
- every result carries source evidence and a factual explanation.

An external LLM may later enhance ordering through `RecommendationEnhancer`. The backend currently accepts only a permutation of the exact deterministic recommendations, including unchanged facts, skill impacts and explanations. Invented IDs, changed facts, duplicate items, malformed responses, exceptions, and a 1.5-second timeout use the deterministic fallback. Free-form AI wording requires an additional grounded explanation contract before it can be accepted. No provider is called and no API key is required today.

Audience matching accepts either the employee's current role or target role, and always the employee's current grade. Readiness is a weighted skill-requirement percentage, not a promotion decision. History similarity uses event type or overlapping developed skills in the preceding twelve months.

## Team integration

See [the integration contract](docs/BACKEND_HANDOFF.md) for directory ownership, response shapes, error codes, and frontend examples. The source DTOs are in `src/contracts/types.ts` and `src/contracts/api.ts`. The checked-in `docs/fixtures/*.json` files are sample API responses only; production always reads SQLite and invokes the domain service.

The homepage is a scaffold for participant 3. A working deterministic implementation is supplied for participant 1 to review and extend; there are no fixture recommendations in the production flow. Authentication is outside this MVP: employee and HR routes are logically separated, but there is no access-control barrier between them.

## Main demo scenario

1. Open an employee profile.
2. Inspect effective skills, target grade, readiness, and gaps.
3. Load one to three explainable development recommendations.
4. Complete one activity and observe recalculated progress and recommendations.
5. Import an additional employee/history pair without changing source code.
6. Open the HR summary and inspect organization-level gaps and participation.

## Data and privacy

The included starter data is synthetic and belongs to the private hackathon repository. Do not replace it with real personal data or expose employee engagement details in public employee views.

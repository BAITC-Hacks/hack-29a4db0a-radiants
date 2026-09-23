# Передача backend участникам 1 и 3

Ветка: `feature/backend-docker`. Запуск всего приложения: `docker compose up --build`.
Для разработки: Node.js 22+, `npm ci`, `npm run dev`.

## Владельцы

| Участник | Файлы |
| --- | --- |
| 1 — Domain/AI | `src/domain/**`, `src/ai/**` |
| 2 — Backend | `src/server/**`, `src/app/api/**`, `src/contracts/**`, dependencies, Docker, конфигурация, README |
| 3 — Frontend | `src/app/**` кроме `api`, `src/components/**`, `src/styles/**` |

Backend уже содержит рабочий `DeterministicCareerQuestService` и `DeterministicEnhancer` для автономного запуска. Участник 1 продолжает их разработку; перед merge следует согласовать изменения этих файлов. Для другого domain entry point участник 2 меняет импорты в `src/server/services/career-quest.ts`. Публичные DTO и зависимости меняет участник 2. Ветки других участников этим этапом не объединяются автоматически.

## Контракт участника 1

`CareerQuestDomainService` в `src/contracts/types.ts`:

```ts
buildEmployeeProjection(input: EmployeeDomainInput): EmployeeProjection;
recommend(input: RecommendationDomainInput): RecommendationResult;
buildHrSummary(input: HrDomainInput): HrSummary;
```

Входы уже проверены Zod; функции чистые, синхронные, без SQL и HTTP. Официальные сущности сохраняют snake_case (`employee_id`, `event_id`), вычисленные DTO используют camelCase. Дата доступности — `2026-10-01`. Формула изменения навыка соответствует договорённости датасета: `min(current + gain, max_level)`.

`RecommendationEnhancer.enhance(result, input)` асинхронен. Сейчас он возвращает исходный результат. Серверная граница разрешает только перестановку точных рекомендаций и смену `source`; при любом изменении фактов или объяснения срабатывает fallback. Кандидаты передаются копией; таймаут — 1500 мс. Будущий сетевой provider должен самостоятельно отменять запрос при timeout и возвращать deterministic результат при отсутствии ключа. Добавление нового provider не требует изменений frontend.

## Контракт участника 3

Все запросы относительные: `fetch('/api/...')`. Каждый успешный ответ обёрнут в `data`; проверять `response.ok` перед чтением `data`.

| Запрос | Содержимое `data` |
| --- | --- |
| `GET /api/health` | `{ status, schemaVersion, counts }` |
| `GET /api/employees` | `{ items: EmployeeCard[], total }` |
| `GET /api/employees/:id` | `EmployeeProjection` |
| `GET /api/employees/:id/recommendations` | `RecommendationResult` |
| `POST /api/employees/:id/activities/:eventId/complete` | `{ activity, projection, recommendations }` |
| `POST /api/import` | `{ employeesInserted, employeesUpdated, historyInserted, historySkipped }` |
| `GET /api/hr/summary` | `HrSummary` |

Список поддерживает `search`, `role`, `grade`, `department`; HR — `role`, `grade`, `department`. Фильтры объединяются через AND; пустой результат допустим. `readiness` — число от 0 до 100 или `null`, а не объект. Объяснение, flags и skill impact находятся внутри `recommendations[i].evidence`. Пустой массив рекомендаций необходимо показывать честно. `targetStatus: 'no_target'` означает отсутствие карьерной цели.

```ts
import type { ApiSuccess, CompleteActivityResult } from '@/contracts/api';

const response = await fetch(`/api/employees/${employeeId}/activities/${eventId}/complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
if (!response.ok) throw new Error((await response.json()).error.message);
const { data } = await response.json() as ApiSuccess<CompleteActivityResult>;
// Обновить экран из data.projection и data.recommendations.
```

Для импорта создать `FormData`, добавить файл или текст в `employees` и/или `history`, отправить POST. Заголовок Content-Type для FormData браузер выставляет сам. JSON принимает wrapper `{ meta, employees }`, массив или один профиль. CSV должен содержать все официальные колонки. `details[].row` для JSON — номер элемента от 1, для CSV — номер строки от 2; `file` сохраняет имя загруженного файла.

Ошибки: `{ error: { code, message, details: [{ file?, row?, field?, message }] } }`.
HTTP 400 — повреждённый JSON/multipart или пустой импорт; 422 — ошибки значений/ссылок; 404 — неизвестный сотрудник/мероприятие; 409 — повторное завершение; 500 — серверная ошибка. Файл со смешанными валидными и невалидными записями отклоняется целиком.

## Демо и сохранение данных

В чистой БД: 60 навыков, 32 role profiles, 200 сотрудников, 40 мероприятий, 2743 записи истории. Healthcheck автоматически инициализирует БД. Записи завершений и импорт переживают restart/recreate контейнера благодаря named volume. Удаление демо-данных — отдельная команда `docker compose down -v`.

Проверки: `npm test`, `npm run build`. Тесты работают с временными отдельными БД и не изменяют демо-volume.

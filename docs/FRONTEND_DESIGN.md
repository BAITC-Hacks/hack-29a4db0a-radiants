# Halyk frontend design

## Reference and assets

Updated 2026-09-23 on `feat/halyk-design`, based on team main `85a7f26`.

- Reference: https://halykbank.kz/ and its current public stylesheet. Primary interface green #00805F, white surfaces and restrained neutral backgrounds. Only the visual style is used; the application identity is Career Quest.
- Typeface: Manrope, also used on the official website. The complete variable font is self-hosted in `public/fonts`, includes Cyrillic, and loads without contacting a font service. Weights 200–800; source https://github.com/google/fonts/tree/main/ofl/manrope; OFL license bundled alongside the font.
- Header: a text-only Career Quest name. The bank logo, its public SVG asset and the bank name in the accessible header label were removed at the user's request. The name remains visible on small screens.

## Product decisions

- Russian interface, buttons, errors and accessible labels, explicitly requested by the user. Employee names, roles, skill/course names and explanation text are shown as supplied by the server. Dates and numeric display use Russian locale.
- One concise header: brand, Development, Team overview and Upload data.
- Profile identity and career goal share a single summary. Readiness appears only when a target exists; missing goals do not suggest zero employee performance.
- Recommendations lead the page. The primary action is explicit: mark the activity completed. No decorative AI imagery, generic motivational hero, raw score, reward badges or repeated summaries.
- Expected skill changes and one explanation are immediately visible. Structured evidence and participation history remain available through native disclosure controls. AI/system source is small metadata.
- Skills show current and target levels in three columns. Projected values/gaps and additional skills remain accessible in clearly labeled disclosures. Profiles without a goal display every reported effective skill directly, including zero levels.
- Mandatory assignments remain separate from the completed learning history, with their due dates. Long history and HR tables scroll within their own region; no records are dropped.
- Import shows a clear JSON-then-CSV instruction, selected file name/type/size, upload result and safe refresh retry.
- 44px primary controls, keyboard focus, skip link, semantic tables, native details, reduced-motion support and layouts down to 320px.

## Boundaries

Backend, domain formulas, contracts and recommendation request control are unchanged. The API adapter changes only fixed user-facing copy. Existing UI assertions were updated for intentional localized text/markup; no new test scenarios were added.

## Validation for this design change

- Next.js production build and its TypeScript phase: pass.
- ESLint: pass.
- Automated tests were not run for this design request. Earlier test totals in FINAL_VALIDATION.md describe the team's pre-redesign baseline, not this change.
- Browser presentation review uses the real API with a separate scratch SQLite database and no AI key; no production data is modified.
- Reviewed the employee, team and import screens at desktop width, and the employee layout at 390px. Manrope renders correctly; the mobile document has no horizontal overflow. A cramped file-format line found during review was separated into its own line.
- Logo-removal follow-up: production build, TypeScript and ESLint pass. Employee/team/import screens contain no bank logo; the Career Quest name is visible at 1280px and 320px, with no document overflow at 320px. The removed SVG is absent from public assets. No automated tests were run for this change.

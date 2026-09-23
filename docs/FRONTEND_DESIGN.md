# Frontend presentation update

> Historical presentation notes. The current authenticated Russian interface, Manrope styling and validation are documented in [FRONTEND_PRIVATE_UI.md](FRONTEND_PRIVATE_UI.md).

## Audit and direction

The previous view used a slogan, uppercase section labels, repeated bordered cards, a readiness ring alongside a bar, decorative icons, tinted badges, and small body text. This spread a short employee profile across several panels and pushed skills and recommendations down the page.

The updated view uses a compact internal workspace layout:

- Text navigation and a functional **Development plan** heading.
- One employee summary with role, department, tenure, readiness and current/target career path.
- A single readiness bar with the existing decimal formatter and accessible value text.
- Skill rows in a semantic table: current progress, projected, required and gap. Critical is a plain contextual label.
- Recommendations remain distinct activities with restrained borders. Expected changes and all supplied reasons remain visible; optional AI text uses a small **AI-assisted explanation** label.
- HR uses tables for competency counts, employee follow-up and participation. Optional server metrics use a compact row; missing data is not invented.
- A neutral palette with one dark green accent; 6px controls, 8px panels, 12px modal. No gradients, glow, background blur or dashboard shadows. The modal alone has a shadow.
- System typography, 28px page titles, 20px section titles, 14px body and 12–13px metadata. Motion is limited to loading and progress, respecting reduced-motion preferences.

## Preserved behavior and boundaries

This is a presentation change. API adapter, request hooks, shared types, domain formulas and backend tests are unchanged. Completion still uses the returned/refetched EmployeeView, actual old/new skill values and readiness delta. Rejected and uncertain mutation outcomes retain their existing distinct behavior. Import still uploads the original file; no parsing or data normalization was added.

The no-next-step message remains generic unless targetStatus explicitly indicates a missing goal. No invented event duration, start action, catalog diagnosis, employee role in HR, or new summary metric was added for visual completeness.

## Verification

- Main and teammate branches were inspected before editing. Main at that point was `1bef61f`, adding the official dataset adapter and imported-profile tests without changing this frontend's API contract. No teammate edits were overwritten or merged as part of this design change.
- TypeScript, lint, all 53 tests on the frontend branch and production build pass.
- Browser checks use the production build and a temporary local fixture API, separate from the delivered application. They cover selection, decimal readiness, expected changes and reasons, completion with actual delta/skills, no-next-step state, HR-to-profile navigation, import and optional AI text.
- Target layout is 1366×768. Employee, target, readiness, skill rows and the first recommendation's rationale are visible in the initial viewport. Mobile navigation retains text labels; wide HR participation tables scroll inside their own region.
- A final fetch discovered `feature/backend-docker` at `61747ec`. It already incorporates frontend `92dd0fd`, adds Next.js/SQLite, changes only App's client directive in the components, and adapts routes/envelopes in the API layer. This presentation commit leaves that layer unchanged; retain the backend's client directive, API adapter and Next.js layout when integrating.
- A merge preview found only a README conflict from the optional design-document link. That link was removed in a follow-up so the runtime branch can retain its startup README. The design handoff remains in this document.
- The actual backend integration remains a separate verification step. Fixture checks do not establish production persistence or live OpenAI behavior.

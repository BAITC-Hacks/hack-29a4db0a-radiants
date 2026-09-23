# Privacy integration validation — 2026-09-23

## Automated checks

- `npm test`: 229 passed, 2 opt-in live AI tests skipped, 18 passing files.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- Production multi-stage Docker build, including `next build`: passed.

The first unrestricted test run during a concurrent Docker build exceeded four timing limits on the Windows laptop; no business assertion failed. Vitest now caps workers at two to keep password derivation and SQLite fixtures within laptop memory. The ordinary `npm test` command passed after that change.

Coverage includes fresh auth bootstrap (including actual generated-password login), existing v1-to-v2 migration without history loss, own-only employee access, HR access, self-only completion, role spoofing rejection, cookie/hash storage, expiry, logout, inactive users, CSRF, Origin, throttling, account provisioning without privilege escalation, and JSON/multipart streaming size limits. Protected requests reject unauthorized callers before reading uploaded bodies.

Diagnostics checks cover all 200 supplied profiles and preserve recommendation parity. Existing AI source/snapshot, late-result cancellation, import rollback and readiness arithmetic checks remain enabled. Frontend auth timeout/session cancellation tests are included.

## Isolated Docker acceptance

Project `career-quest-privacy-acceptance`, port 3001, separate named volume, no OpenAI traffic (`AI_EXPLANATIONS_ENABLED=false`). Initial health: schemaVersion 2; skills 60, role profiles 32, employees 200, events 40, history 2743. Bootstrap credentials were read by the operator script inside the container and never printed in output.

Actual HTTP checks passed:

1. Anonymous private APIs return 401; employee list contains only that employee.
2. Both employee accounts are denied the other's profile; employee HR/import requests return 403.
3. HR cannot complete a step for an employee; invalid CSRF or Origin also returns 403 without a write.
4. HR can create an employee login; requesting an HR role through that endpoint is rejected.
5. E0043 completes EV_036: readiness 63.2 → 65.2, no eligible recommendations; diagnostics explain blockers.
6. HR imports jury JSON then CSV. Population becomes 201.
7. Logout revokes the stored session. Container restart retains a different valid session, completed progress and record counts, without duplicate seed.

Temporary known-password browser accounts were created only in the isolated test volume. They are not production bootstrap accounts or repository defaults.

## Browser flow

- Anonymous page contains only sign-in, no personal profiles.
- Employee login opens E0178 directly, with no employee selector, HR navigation or import.
- Completing EV_005 shows readiness 71.3 → 74.1 (+2.8 percentage points), System Design 1 → 2 and refreshed recommendations/history.
- Logout removes the profile and shows the sign-in form.
- HR login shows profile selection, HR analytics and import, with zero Complete activity buttons.
- E0043 empty state lists the prerequisite blocker for Architecture Review Circle and completed non-repeatable activities.
- HR dashboard displays 201 employees after import.
- Reuploading jury CSV through the real HR dialog succeeds and reports two skipped existing history records.

## Scope and remaining work

No new billed OpenAI request was needed for this change; previous live evidence remains in AI_VERIFICATION.md and FINAL_VALIDATION.md. Auth checks precede the AI endpoint and disabling AI prevents the provider call. Corporate SSO, credential recovery, peer-sharing consent, cross-tab refresh and account-management UI are explicitly scoped in BACKEND_PRIVACY.md and FRONTEND_PRIVACY_PLAN.md.

PR #13's independent report was merged. The old frontend branch `b422db2` was not merged wholesale; useful retry/history UI was adapted while preserving current contracts and safeguards.

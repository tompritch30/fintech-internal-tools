# Adding an app (checklist)

Use this for each business app (KYC, refunds, feature flags). One app per session and PR. Read
[AGENTS.md](../AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first.

## 1. Permissions (needs human review)
- [ ] Add the app's permissions to `PERMISSIONS` in `packages/core/src/rbac/permissions.ts`,
      for example `refunds:read`, `refunds:approve`.
- [ ] Map them to roles in `ROLE_PERMISSIONS`. New IdP roles also need a row in the `roles`
      seed and in the Keycloak realm (`infra/keycloak/internal-tools-realm.json`).
- [ ] Add tests in `packages/core/test/rbac.test.ts`: denied for the wrong role (with its
      `access.denied` row) and allowed for the right one (positive control).

## 2. Data
- [ ] Add tables to `packages/db/src/schema.ts`, then `pnpm db:generate`. Review the SQL.
- [ ] Add a migration granting `app_runtime` only the privileges the app needs.
- [ ] Seed dummy data only (`example.test` emails, fake names and amounts).

## 3. Server code
- [ ] Every server action: `export const x = defineAction(permission, "app.action", async (ctx, ...) => ...)`
      in a `"use server"` file. The test in `apps/web/test/actions-use-define-action.test.ts` enforces it.
- [ ] Keep business logic in a plain module next to the action (like
      `app/(platform)/demo-record/note.ts`) so it can be tested with real Postgres.
- [ ] Every business write goes through `withAudit(db, entry, fn)`. Never insert into `audit_log`
      directly (`audit-writes-only-via-core.test.ts` fails if you do).
- [ ] Every page that reads data starts with `requirePagePermission(permission, "/route")`.
- [ ] Approvals and masking: use the A2 design in ARCHITECTURE.md §4. Mask on the server; never
      pass a whole sensitive row to a client component.

## 4. UI
- [ ] Pages live under `apps/web/app/(platform)/<app>/` so they get the `AppShell`.
- [ ] Add nav items in `app/(platform)/layout.tsx`, shown only when the user has the permission.
- [ ] Use the kit: `ListView` for queues, `RecordHeader` + `CommandBar` + `Timeline`
      (`listAuditForEntity`) for records. Show only commands the user may run.
- [ ] Add a component to `packages/ui` only when a real app needs it.

## 5. Tests
- [ ] Named server tests for each business rule, written first and shown failing.
- [ ] One test per write action asserting its audit row.
- [ ] One or two Playwright tests in `apps/web/e2e/` for the main flow. No snapshots.

## 6. Finish
- [ ] Update `.env.example` for any new variable.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` pass locally.
- [ ] `CI / verify` and `CI / e2e` green.
- [ ] Add a row to `docs/DEVIN-LOG.md`.

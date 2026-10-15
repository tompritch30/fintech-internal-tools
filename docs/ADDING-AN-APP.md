# Adding an app (checklist)

Use this for each business app (KYC, refunds, feature flags). One app per session and PR. Read
[AGENTS.md](../AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first.

## 1. Permissions (needs human review)
- [ ] Add the app's permissions to `PERMISSION_REGISTRY` in
      `packages/core/src/rbac/permissions.ts`, for example `refunds:read`,
      `refunds:approve`. Each entry is `{ description, roles }`; `PERMISSIONS` and
      `ROLE_PERMISSIONS` are derived from the registry, so don't edit them directly.
- [ ] New IdP roles also need a row in the `roles`
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
- [ ] Approvals and masking: see ARCHITECTURE.md §4.2/§4.3. Mask on the server; never
      pass a whole sensitive row to a client component.

### Approvals and masking patterns (A2)

- **Approval kind:** declare it next to your app with `defineApprovalKind`:

  ```ts
  const issueRefund = defineApprovalKind<{ amount: number }>({
    kind: "refund.issue", subjectType: "refund",
    requestPermission: "approvals:request", approvePermission: "approvals:decide",
    onRequested: async (tx, req) => {
      // create the app's own record here (e.g. a refunds row keyed by req.id)
      // so record + approval_requests row + audit row commit together
    },
    onApproved: async (tx, req) => { /* apply the effect of approval */ },
  });
  ```

  Then call `requestApproval(db, actor, issueRefund, { subjectId, payload })`,
  `decideApproval(db, actor, issueRefund, { id, decision, note, expectedVersion })`,
  `cancelApproval(db, actor, { id, note })` — all exported from `@fit/core`. The engine
  checks permissions, self-approval, staleness and writes the audit rows; keep
  sensitive data out of `payload` where you can, and know it never reaches `audit_log`.
- **Masked entity:** declare it next to your app with `defineMaskedEntity` from
  `@fit/core/masking` (the subpath matters: the module imports `server-only`, so it is
  not re-exported from `@fit/core`):

  ```ts
  import { defineMaskedEntity, mask } from "@fit/core/masking";

  const customer = defineMaskedEntity<Customer>({
    entityType: "customer",
    policies: [{ field: "iban", style: "last4", unmaskPermission: "pii:unmask" }],
    load: (tx, id) => /* select the row by id */,
  });
  ```

  Render `mask(row, customer.policies)` — a `Masked<T>` — and pass only that to client
  components. Call `unmask(db, actor, customer, { entityId, field, reason })` from a
  server action when a user with `pii:unmask` needs the raw value; it audits the read.
- **Nested records:** `mask` refuses a record that still contains an unpoliced object
  or array field (compile-time error, and a `ValidationError` at runtime). This fails
  closed: a nested sensitive field can't leak because nobody wrote a policy for it.
  Mask each part separately and combine:

  ```ts
  const { address, ...rest } = row;
  const masked = { ...mask(rest, customerEntity.policies), address: mask(address, addressPolicies) };
  ```

  `Date` fields are exempt (they serialize as ISO strings).
- **Payloads must be JSON-safe:** approval payloads live in a `jsonb` column, so
  `defineApprovalKind`/`requestApproval` reject `Date`, `bigint`, `Map`, class
  instances, functions and `NaN`/`Infinity` at compile time and runtime. Keep dates as
  ISO strings and money as integer minor units or a string in payload types.

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

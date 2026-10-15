# Playbook: new-internal-tool

Build one new business app (refunds, KYC, feature flags, …) on the shared platform:
one session, one branch, one PR. Written from the refunds session
([PR #10](https://github.com/tompritch30/fintech-internal-tools/pull/10)). The rules
are in `AGENTS.md`, `docs/ADDING-AN-APP.md` and `REVIEW.md`. This playbook is the
order of work and the traps found along the way. If it disagrees with those files,
they win. Fix the playbook in a PR.

## What's needed from Thomas
- The business rules, numbered. Each rule becomes a named test.
- Whether `packages/core` may change. If it may not, the app reuses the existing
  permissions (see step 2).
- Thresholds and limits. Each one becomes an env var with a default.
- Whether the PR adds a migration. If it does, Thomas merges it; Devin doesn't.

## Procedure

### 0. Set up (about 5 minutes)
1. `source ~/.nvm/nvm.sh && nvm use 24 && corepack enable && pnpm install`.
2. `cp .env.example .env && docker compose up -d --wait postgres keycloak`.
3. `pnpm db:migrate && pnpm db:seed`. Then confirm the baseline is green:
   `pnpm lint && pnpm typecheck && pnpm test`.
4. `pnpm --filter @fit/web exec playwright install --with-deps chromium` (the browsers
   are not in the snapshot), then `pnpm test:e2e`.
5. Branch: `git checkout -b devin/$(date +%s)-<app>`.

### 1. Read before planning
- `AGENTS.md`, `docs/ADDING-AN-APP.md`, `docs/ARCHITECTURE.md` §4 (core APIs), `REVIEW.md`.
- The core APIs you'll use, in the source: `packages/core/src/approvals/approvals.ts`
  and `packages/core/src/masking/masking.ts`. Note what is missing. For example,
  approvals has `onRequested`/`onApproved` but no `onRejected`.
- `apps/web/AGENTS.md`: Next.js 16 differs from older versions. Read the relevant
  pages under `apps/web/node_modules/next/dist/docs/` (layouts-and-pages,
  mutating-data, forms, error-handling) before writing routes.
- The existing pattern: `app/(platform)/demo-record/`, `lib/auth.ts`, `lib/action.ts`.

### 2. Send the plan with risks before building
Thomas asks for this. Send one message listing each risk, the default you'll use and
the decision needed. From refunds, the questions that will come up again:
- **Permissions vs "don't touch core".** ADDING-AN-APP §1 says to add `<app>:*`
  permissions in core. If core is off-limits, map the app onto existing ones
  (`approvals:request` = maker, `approvals:decide` = checker, `pii:unmask` = reveal),
  and say who loses what. In refunds, analysts can't reveal emails.
- **Missing engine hooks.** If you need them, derive the state from the approval
  request rather than storing it twice. Log it as a known gap.
- **Testing self-approval.** The seeded analyst can't approve and the seeded approver
  can't request, so add a user with both roles to `infra/keycloak/internal-tools-realm.json`
  **and** the seed (refunds added `senior`).
- **Concurrency and idempotency.** Say exactly how double-submit and two-users-at-once
  are stopped (row lock, unique key, version check, DB CHECK backstop).
- **Threshold edges.** "Over £250" means exactly £250.00 does *not* need approval. Say so.
- **The Timeline doesn't mask.** Keep sensitive values out of the app's audit rows,
  and test that.

### 3. Commits, in this order (Thomas asked for logical commits, red tests first)
1. **Schema + migration + seed.** Tables in `packages/db/src/schema.ts`, then
   `pnpm db:generate` (`drizzle-kit generate --name <app>`). Add a second, custom
   migration (`drizzle-kit generate --custom --name <app>_guard`) for triggers, `REVOKE ALL
   … FROM PUBLIC` and least-privilege `GRANT`s to `app_runtime`: no DELETE, and
   column-level UPDATE where possible. Seed deterministic fake data (`example.test`
   emails, no full card numbers).
2. **Named rule tests against a stub module.** Write `apps/web/test/<app>.test.ts`
   (real Postgres; `describe("rule N …")`, one `it` per rule plus a positive control for
   every denial). Use a stub `<app>.ts` that exports the real signatures and throws.
   Run the tests and save the red output (`pnpm --filter @fit/web exec vitest run … >
   ~/red-<app>.txt`), because it goes in the PR. Commit.
3. **Implementation.** Plain module `app/(platform)/<app>/<app>.ts` that takes
   `ActionContext`/`Db`, so tests call it without Next. Every write goes through
   `withAudit` or the approvals engine. Make the tests green and run them 3 times
   (concurrency tests can be flaky).
4. **UI + 1–2 Playwright tests.** Pages use `ListView`, `RecordHeader`, `CommandBar`
   and `Timeline`. `actions.ts` wraps every action in `defineAction`. Forms use
   `useActionState` and return expected errors as state (don't throw them).
5. **Docs + dev-log row.** `.env.example` and the `docker-compose.yml` web env (keep
   them in step), an ARCHITECTURE section (rule → enforcement table, grants), known
   gaps, demo users, ADDING-AN-APP notes, and a `docs/DEVIN-LOG.md` row.

### 4. Verify locally
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm --filter @fit/web build`.
Record the counts in the PR.

### 5. Open the PR
- `.github/pull_request_template.md`: Summary, a **Rules → tests** table (rule, test
  name, positive control, shown failing first?), screenshots, and what you couldn't
  verify.
- Put the red run in a `<details>` block. Mark tests that weren't red-first honestly.
  DB-backstop tests (CHECKs, grants, seed contents) pass against the stub because the
  migration landed in commit 1.
- If there's a migration (or core/playbook/AGENTS/blueprint changes), state at the top
  that a human must merge.

### 6. Recording and screenshots
Hand off to the testing agent (the user asked for a recording, so that counts as
approval). Name the flows, the users and the screenshots you want. While it runs, keep
working in a **git worktree** (`git worktree add ../<dir> -b <branch> origin/main`):
the testing agent shares the main checkout, so don't switch branches there. Embed the
screenshots in the PR body, and attach the recording when you report back.

### 7. CI, Devin Review, conflicts
- `CI / verify` and `CI / e2e` must be green.
- Trigger Devin Review, fix blocking findings, re-review, and add a line to the PR body
  saying what it found. Reply on every review thread.
- `docs/DEVIN-LOG.md` conflicts whenever another PR lands first. Merge `origin/main`
  (don't rebase a pushed branch), keep both rows and renumber yours. Re-run typecheck
  and tests if core changed underneath you.

## Traps found in the refunds session
- **Drizzle drops the table name in single-table selects.** A correlated subquery
  referencing `payment_id` became ambiguous (Postgres `42702`). Qualify it in raw `sql`
  (`"payments"."id"`).
- **Next's route announcer has `role="alert"`.** `getByRole("alert")` matches it too.
  Scope to your form: `getByRole("form", { name: … }).getByRole("alert")`.
- **`server-only` breaks Vitest.** `apps/web/vitest.config.ts` aliases it to the
  package's empty export.
- **`process.env` typing.** Take `Record<string, string | undefined>` in config loaders,
  so tests can pass literal envs.
- **Core rules since #9:** `mask` refuses records with nested object/array fields (Dates
  are fine), and approval payloads must be JSON-safe. Keep payloads to ids and integer
  pence.
- **Idempotency key from the server.** The page mints the record's UUID and puts it in
  the form, so a double submit hits the same primary key.
- **Prettier isn't installed.** ESLint is the formatter gate.

## Forbidden
- Merging a PR that adds a migration or changes core, a playbook, `AGENTS.md` or
  `.devin/blueprint.yaml`.
- Changing `packages/core` when the brief says not to. Raise a separate core PR instead.
- Real PII, real secrets, or committing `.env`.
- Mocking the database, snapshot tests, or more than 2 E2E tests per app.

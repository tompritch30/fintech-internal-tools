# AGENTS.md — working rules for every Devin session

Read this first. The critical rules are at the top. Detail lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/ADDING-AN-APP.md](docs/ADDING-AN-APP.md).

## 1. Critical rules

1. **One session = one branch = one PR.** Branch name: `devin/<timestamp>-<slug>`.
2. **CI must be green** (`CI / verify` and `CI / e2e`) before merge.
3. **You may merge your own PR** when CI is green and review raises no blocking issues.
   A human does not review every PR.
4. **Exception: a human must review and merge** any PR that changes:
   - anything under `packages/core/`;
   - a playbook (creates or edits one);
   - `AGENTS.md`;
   - `.devin/blueprint.yaml`.
   Do not merge these yourself. Say in the PR description that human review is needed.
   `.github/CODEOWNERS` enforces this through branch protection.
5. **Dummy data only.** No real PII. No real secrets. Never commit a `.env` file.
6. **Every authorization check runs on the server.** Build every server action with
   `defineAction(permission, fn)` (a test enforces it). Call `requirePermission` (or
   `requireRole`) in every route handler and in pages that read data. Hiding a button in the UI
   is a convenience, never the control. A denial writes an `access.denied` audit row.
7. **Every change to business data is audited in the same transaction**, via
   `withAudit(tx, …)`. Never write to `audit_log` any other way (a test enforces it).
   Never update or delete it. Each write action's test asserts its audit row.
8. **Masked fields are masked on the server.** No admin bypass. Unmasking needs a
   reason and writes an audit row.
9. **Log the session.** Append one row to [docs/DEVIN-LOG.md](docs/DEVIN-LOG.md).

## 2. Testing rules

- Each business rule becomes a **named server-side test**, for example
  `it("rejects approval when approver is the requester")`.
- Test the rule, not the implementation. Don't assert on internal calls.
- **Show each new test failing first.** Paste the failing output in the PR
  description, or commit the test before the implementation.
- **Each negative test needs a positive control.** Example: the same request by a
  *different* approver succeeds.
- Server tests run against **real Postgres**. Don't mock the database.
- Each app gets **at most 1–2 end-to-end tests** (Playwright).
- **No snapshot tests.**

## 3. Commands

Run from the repo root. Node and pnpm versions are pinned (`.nvmrc`, `packageManager`);
run `corepack enable` once.

| Task | Command |
|---|---|
| Start the full stack (web, Postgres, Keycloak; runs migrate + seed) | `docker compose up --build` |
| Install dependencies | `pnpm install` |
| Run web on the host (hot reload) | `docker compose up -d postgres keycloak` then `pnpm dev` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test (needs Postgres running) | `pnpm test` |
| Migrate | `pnpm db:migrate` |
| Seed | `pnpm db:seed` |
| Generate a migration from schema changes | `pnpm db:generate` |
| End-to-end test (needs full stack running) | `pnpm test:e2e` |

Keep this table in step with the root `package.json`. If you change a script, change
this table in the same PR.

## 4. Data, config and secrets

- All config is env vars. Every variable is listed, with a comment, in `.env.example`.
  Update it whenever you add or change a variable.
- The demo passwords and client secret in `.env.example` and `infra/keycloak/` are
  fake and local-dev-only (`demo-only-change-me`). Never reuse them anywhere else.
- `.env` and `.env.*` (except `.env.example`) are gitignored. Keep it that way.

## 5. Where things go

- `apps/web` — the single Next.js app. Platform pages live in the `(platform)` route
  group. Each business app gets its own route group (see ADDING-AN-APP.md).
- `packages/core` — login/session, RBAC, audit, and (from A2) approvals and masking.
  **Human review required.**
- `packages/db` — Drizzle schema, SQL migrations, seed.
- `packages/ui` — design tokens and shared components.

## 6. Dev log

Every session appends one row to `docs/DEVIN-LOG.md`, in its existing column format.
Fill in your own facts (what was asked, time, PR link, what went wrong or was
corrected, outcome). Leave Thomas's columns as `_Thomas to fill_` and cost as
"See billing page".

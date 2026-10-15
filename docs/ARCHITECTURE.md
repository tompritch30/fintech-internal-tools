# Architecture — internal-tools platform

This is the shared platform that the internal business apps (refunds, KYC, feature
flags) will build on. Session A1 builds the foundation only: login, RBAC and the
append-only audit log. Approvals and field masking are designed here and built in A2.

Background: [research.md](research/research.md) Q2 (what the platform layer must
replace), Q3 (audit, approvals, access control) and R2-Q2 (the list → record → actions
UI that ops staff already know).

## 1. Stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Web | Next.js (App Router), one app: `apps/web` |
| Monorepo | pnpm workspaces |
| Runtime | Node 24 (Active LTS today; pinned in `.nvmrc` and `engines`) |
| Database | Postgres 18 |
| ORM | Drizzle ORM (see §2) |
| Identity | OIDC. Keycloak locally, Entra ID later |
| OIDC library | `openid-client` (authorization code + PKCE) |
| Sessions | Server-side sessions in Postgres, opaque cookie |
| Tests | Vitest on real Postgres; Playwright for 1–2 E2E tests per app |
| Local stack | Docker Compose |
| CI | GitHub Actions, workflow `CI`, two required jobs: `verify` and `e2e` |

Note: Node 26 becomes Active LTS on 2026-10-28 (Node release schedule). Moving to it
is a one-line change in `.nvmrc`, `engines`, the Dockerfile and the blueprint.

## 2. ORM choice: Drizzle

We use **Drizzle ORM**.

- It is a thin, SQL-first layer. The queries you write map closely to the SQL that runs.
- Migrations are plain SQL files in `packages/db/migrations/`. A reviewer reads the
  exact SQL that will run, including the audit trigger and the grants.
- There is no separate query engine, and the client is light. CI installs and
  starts faster.

*Considered: Prisma. Rejected because of its heavier generated client and engine and
its less SQL-transparent migrations.*

## 3. Components, data flow and security boundaries

```mermaid
flowchart LR
  subgraph Client["Browser (untrusted)"]
    B["User's browser<br/>UI may hide controls — convenience only"]
  end

  subgraph IdP["Identity provider"]
    KC["Keycloak (local)<br/>stand-in for Entra ID<br/>realm roles → 'roles' claim"]
  end

  subgraph Web["apps/web — Next.js App Router (trusted server)"]
    MW["proxy / middleware<br/>route gating: no session cookie → /login"]
    RSC["Server components,<br/>server actions, route handlers<br/>EVERY one calls requirePermission / requireRole"]
    AUTH["/auth/login · /auth/callback · /auth/logout"]
  end

  subgraph Core["packages/core (human-reviewed)"]
    SES["auth + session<br/>OIDC client, PKCE, DB sessions"]
    RBAC["rbac<br/>role → permission map<br/>requireRole / requirePermission"]
    AUD["audit<br/>withAudit(tx, …)"]
    MASK["masking (A2)<br/>mask on server, no admin bypass<br/>unmask needs reason → audit row"]
    APR["approvals (A2)<br/>maker-checker"]
  end

  subgraph DBL["packages/db"]
    DRZ["Drizzle schema + client"]
  end

  subgraph PG["Postgres"]
    T["users · roles · user_roles · sessions<br/>business tables (later)"]
    AL["audit_log<br/>trigger blocks UPDATE / DELETE / TRUNCATE"]
  end

  B -- "HTTPS request + session cookie" --> MW --> RSC
  B -- "1. GET /auth/login" --> AUTH
  AUTH -- "2. 302 to authorize endpoint<br/>code_challenge (S256), state, nonce" --> B
  B -- "3. user signs in" --> KC
  KC -- "4. 302 /auth/callback?code&state" --> B
  B --> AUTH
  AUTH -- "5. back-channel: code + code_verifier<br/>+ client secret → ID token" --> KC
  AUTH --> SES
  RSC --> RBAC
  RSC --> AUD
  RSC --> MASK
  RSC --> APR
  SES --> DRZ
  RBAC --> DRZ
  AUD --> DRZ
  APR --> AUD
  MASK --> AUD
  DRZ -- "app role: app_runtime<br/>audit_log: SELECT, INSERT only" --> T
  DRZ -- "change + audit row<br/>in ONE transaction" --> AL
  MIG["pnpm db:migrate / db:seed<br/>owner role: app_owner"] -. "DDL, grants, trigger" .-> PG
  RSC -- "masked DTOs only" --> B
```

### 3.1 Login (OIDC)

- Authorization-code flow with **PKCE (S256)**, plus `state` and `nonce`. The client is
  confidential, so the token request also sends the client secret.
- `state`, `nonce` and the `code_verifier` live in a short-lived, httpOnly,
  `SameSite=Lax` cookie during the redirect. It is deleted at the callback.
- The callback validates the ID token (issuer, audience, signature, nonce), upserts the
  user, syncs their roles from the `roles` claim, and creates a session.
- **Swapping to Entra ID needs env vars only:** `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET`, and unset `OIDC_INTERNAL_ISSUER`. Entra app roles arrive in the
  `roles` claim by default; `OIDC_ROLES_CLAIM` covers any other name.
- Logout deletes the session row, writes an `auth.logout` audit row and redirects to
  the IdP's end-session endpoint.

### 3.2 Sessions

- Server-side sessions in the `sessions` table. The cookie holds a random 256-bit
  token. The table stores only its SHA-256 hash, so a database read can't be replayed
  as a cookie.
- Cookie: `httpOnly`, `SameSite=Lax`, `Secure` when `APP_URL` is HTTPS.
- Sessions expire after `SESSION_TTL_HOURS`. Logout or deleting the row revokes a
  session at once. That is the main reason to choose DB sessions over a JWT cookie.

### 3.3 Issuer fix (Docker Compose)

The browser reaches Keycloak at `localhost:8080`, but the web container can only reach
it at `keycloak:8080`. If Keycloak derives its issuer from the request host, the two
see different issuers and ID-token validation fails.

The fix, set once in `docker-compose.yml`:

1. Keycloak runs with `KC_HOSTNAME=http://localhost:8080`. Its issuer is always
   `http://localhost:8080/realms/internal-tools`, whoever calls it.
2. The web container gets `OIDC_ISSUER=http://localhost:8080/realms/internal-tools`
   (used for validation and browser redirects) and
   `OIDC_INTERNAL_ISSUER=http://keycloak:8080/realms/internal-tools`.
3. `packages/core` rewrites server-to-server calls (discovery, token, JWKS) from the
   `OIDC_ISSUER` prefix to the `OIDC_INTERNAL_ISSUER` prefix. Browser redirects keep the
   public URL. When `OIDC_INTERNAL_ISSUER` is unset (host dev, Entra), nothing is rewritten.

### 3.4 RBAC enforcement points

| Layer | What it does | Is it the control? |
|---|---|---|
| Next.js proxy/middleware | No session cookie → redirect to `/login` | Gate only. It does not check roles |
| Server components | `requireUser()` / `requirePermission()` before reading data | **Yes** |
| Server actions, route handlers | `requirePermission()` as the first line, every time | **Yes** |
| UI | Hides buttons the user can't use | **No.** Convenience only |

- The IdP owns role *membership* (realm roles in Keycloak, app roles in Entra). Roles
  are synced to `user_roles` at each login.
- `packages/core` owns the *role → permission* map in code, so a change to it is a
  reviewed change to `packages/core`. The map lives in `PERMISSION_REGISTRY` (built
  by `definePermissionRegistry`): every permission is a `domain:action` key with a
  description and its granted roles, validated and deep-frozen at module load
  (registry and `ROLE_PERMISSIONS`), so a runtime push can't add a grant — a bad
  key, empty description, empty or duplicate role list, or unknown role throws
  `ValidationError` at startup rather than silently misgranting access. `PERMISSIONS`,
  the `Permission` union and `ROLE_PERMISSIONS` are all derived from the registry.
- **Server actions use `defineAction(permission, fn)`.** The wrapper runs
  `requirePermission` before `fn`. A test scans every `"use server"` file in `apps/web`
  and fails if an exported action isn't built with `defineAction`.
- **Denied access is audited.** When `requireRole` / `requirePermission` blocks a
  signed-in user, it writes an `access.denied` audit row (user, required permission or
  role, route or action name) and then throws. This row is written on its own, not
  inside a business transaction, so it survives the rejected request. Unauthenticated
  requests are redirected to `/login` and are not audited (there is no user to record).
- **Prefetches are not audited.** Next.js prefetches pages behind links, which would
  write false `access.denied` rows. Prefetch requests (`Next-Router-Prefetch` /
  `Purpose: prefetch` headers) are still denied but write no row. Pages also don't
  render links the user can't use.
- **Roles can be stale.** Roles sync from the IdP only at login. If someone loses a
  role in the IdP, they keep it until their session ends (at most
  `SESSION_TTL_HOURS`). Revoking the session row ends access at once. See Known gaps.
- A1 roles: `analyst`, `approver`, `admin`. A1 permissions: `platform:access` (any
  role) and `audit:read` (admin). A signed-in user with no role sees a "no access" page.

### 3.5 Audit write path

- `withAudit(tx, entry, fn)` runs `fn(tx)` and then inserts the audit row, **inside one
  database transaction** (a savepoint if `tx` is already a transaction). If the change
  or the audit insert throws, both roll back.
- Each row records: when, who (user id and IdP subject), action, entity type and id,
  before/after JSON, an optional reason, and request metadata.
- **Only `packages/core` writes to `audit_log`.** A test fails if any file outside
  `packages/core/src/audit/` references the `auditLog` table for writing.
- **Every business write goes through `withAudit`.** Each app's tests assert that each
  write action produces its audit row (rule in ADDING-AN-APP.md).
- Login, logout and denied access also write audit rows (`auth.login`, `auth.logout`,
  `access.denied`).

### 3.6 Append-only audit at the database level

- A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger on
  `audit_log` raise an exception. At runtime this blocks every role, including the
  owner.
- The trigger is not absolute. `app_owner` owns the table, so a migration could drop
  or disable the trigger. That change would be a SQL file in `packages/db/migrations/`,
  so it would be visible in review and in git history. Proving that nothing was
  altered needs tamper-evidence (see Known gaps).
- `app_runtime` (the role the app uses) has only `SELECT` and `INSERT` on `audit_log`.
  `UPDATE`, `DELETE` and `TRUNCATE` are revoked.
- A Postgres superuser can also disable triggers. Nobody uses a superuser or the owner
  role at runtime.

### 3.7 Database roles

| Role | Used by | Rights |
|---|---|---|
| `postgres` (superuser) | Container bootstrap only | Creates the two roles below and the database |
| `app_owner` | `pnpm db:migrate`, `pnpm db:seed` | Owns the schema; runs DDL and grants |
| `app_runtime` | The web app at runtime, server tests | CRUD on platform tables; **SELECT + INSERT only** on `audit_log` |

The roles are created by `infra/postgres/init/01-roles.sql`. Docker Compose runs it on
first start; CI runs the same file with `psql`.

### 3.8 Masking

Built in A2 (`packages/core/src/masking/masking.ts`, exported as `@fit/core/masking`).

- Masking runs **on the server, before data reaches the client**. Client components
  only ever receive masked DTOs.
- **No admin bypass.** The `admin` role gets no `pii:unmask` grant and no special case.
  (This closes the Dataverse gap in research Q3, where system administrators bypass
  column security.)
- `mask(record, policies)` is a pure function: it takes no actor or role, returns a
  shallow-copied `Masked<T>` and never mutates the input. It **fails closed on nested
  values**: an object or array field (or `unknown`) that isn't itself a policy field
  is a compile-time error and a runtime `ValidationError`. This was chosen over
  dot-path policies deliberately — a new nested field can't leak by default. `Date`
  fields are allowed (they serialize as ISO strings); mask nested records separately
  and combine the results. `Masked<T>` preserves `null` and `undefined` on masked
  fields. Mask formats (bullet is U+2022; `full` is always 8 bullets so length
  doesn't leak):
  - `last4`: length ≥ 8 → `"••••" + last 4`, else `"••••••••"`
  - `full`: `"••••••••"` always
  - `email`: local part ≥ 2 chars → `"a•••@domain"`; local part of 1 char →
    `"•••@domain"`; no `@` → `"••••••••"`
  - `null`/`undefined` pass through; a non-string runtime value masks as `full`.
- `unmask(db, actor, entity, { entityId, field, reason })` needs the field's policy
  `unmaskPermission` (`pii:unmask`) **and** a non-empty reason, and writes a
  `field.unmask` audit row in the same transaction as the read. The audit row records
  the actor, entity, field and reason — **never the value** (no before/after).
- Guard against leaks by accident: masked data has a `Masked<T>` brand (compile-time
  only, see Known gaps), and `masking.ts` imports `server-only`, so it can't be
  imported from a client component. Because `server-only` throws under plain Node,
  masking is exposed via the `@fit/core/masking` subpath export, not `@fit/core`;
  core's vitest config aliases `server-only` to its `empty.js` so the tests run.
- Policies are declared per entity in code, next to the app that owns the entity, via
  `defineMaskedEntity({ entityType, policies, load })`; `load` runs in the unmask
  transaction.

## 4. `packages/core` scope

`packages/core` is the shared layer that all three business apps build on. It is the
only place these concerns are implemented.

| Module | What it provides | Built in |
|---|---|---|
| `auth` | OIDC client (PKCE), callback handling, logout URL | **A1** |
| `session` | Create, validate and revoke DB sessions | **A1** |
| `rbac` | Role → permission map, `requireRole`, `requirePermission` | **A1** |
| `audit` | `withAudit(tx, …)`, audit read query for the viewer | **A1** |
| `approvals` | Maker-checker approvals engine | **A2** |
| `masking` | Field masking policies, `mask`, `unmask` | **A2** |

### 4.1 Built and tested in A1

Each with a named test against real Postgres and a positive control:

- **OIDC login and session:** a seeded Keycloak user can log in end to end (Playwright),
  logout works, and unauthenticated requests are redirected to `/login`.
- **RBAC:** `requireRole` / `requirePermission` deny a user without the role, and allow
  a user with it. A denial writes an `access.denied` audit row; an allowed call writes
  none; a denied prefetch writes none.
- **Guards on every action:** every exported server action is built with `defineAction`.
- **Audit writes only via core:** nothing outside `packages/core/src/audit/` writes to `audit_log`.
- **Audit:** `withAudit` writes the change and the audit row together, and a failure
  rolls both back. As `app_runtime`, `UPDATE` and `DELETE` on `audit_log` fail;
  `INSERT` succeeds.

#### Built and tested in A2

- **Approvals:** requester can't decide their own request (code: `SelfApprovalError`
  plus an `access.denied` row; DB: `maker_is_not_checker` check). Approver needs the
  kind's approve permission — admin gets it too only if granted, and it isn't, so no
  admin bypass. Only `pending` rows can be decided, optimistic concurrency via
  `version`/`expectedVersion`, exactly one of two concurrent decisions wins. The
  `approval_requests_guard` trigger rejects non-pending inserts, updates to decided
  rows and content changes; `app_runtime` has no DELETE. `onRequested`/`onApproved`
  hooks commit the app's record and effect in the same transaction as the request /
  decision and its audit row. Payloads never appear in audit rows.
- **Masking:** `mask` formats are tested verbatim, input is never mutated, `unmask`
  needs the policy permission plus a reason and writes `field.unmask` — the value is
  never in the audit row. No admin bypass. `Masked<T>` brand checked at compile time.

### 4.2 Approvals engine

Table `approval_requests` (packages/db): `id uuid pk`, `kind`, `subject_type`,
`subject_id`, `payload jsonb`, `status` (enum `pending|approved|rejected|cancelled`,
default `pending`), `requested_by`/`requested_at`, `decided_by`/`decided_at`,
`decision_note`, `version int default 1`. Indexes on `(status, kind)` and
`(subject_type, subject_id)`.

Interface (`packages/core/src/approvals/approvals.ts`, exported from `@fit/core`):

```ts
defineApprovalKind<P>({ kind, subjectType, requestPermission, approvePermission,
  onRequested?, onApproved?, onRejected? }): ApprovalKind<P>
requestApproval(db, actor, kind, { subjectId, payload }): Promise<ApprovalRequest<P>>
decideApproval(db, actor, kind, { id, decision: "approve"|"reject", note?, expectedVersion }): Promise<ApprovalRequest<P>>
cancelApproval(db, actor, { id, note }): Promise<ApprovalRequest>
```

Deviations from the original sketch: the functions take `db`, not `tx` — denials
(self-approval, requester-only cancel) write their `access.denied` row *before* the
transaction opens, so it survives. `onRequested(tx, request)` runs inside the
request's transaction so the app's record commits with the request; `onApproved(tx,
request)` / `onRejected(tx, request)` run inside the decision's transaction so the
effect commits with the decision (a throwing hook rolls back the decision and its
audit row). `cancelApproval` calls neither hook.

Rules: the requester can never approve their own request (checked in code **and** by
the `maker_is_not_checker` CHECK). The approver needs the kind's approve permission.
Rejects and cancels need a non-empty note. Only `pending` requests can be decided;
`expectedVersion` gives optimistic concurrency (a stale or lost race →
`ConflictError`). Audit rows: `approval.requested|approved|rejected|cancelled` on
entityType `approval_request` with before/after `{status, version}` — **payloads are
never copied into audit rows**; the row references the request id.

Database guards (migration `0003_approvals_guard.sql`): the `decision_matches_status`
CHECK ties `decided_by`/`decided_at` to the status; a `BEFORE INSERT OR UPDATE`
trigger rejects inserts that don't start `pending`/v1, updates to non-pending rows
(`already %`), and changes to id/kind/subject/payload/requester/requested_at
(`content is immutable`). `app_runtime` has `SELECT, INSERT, UPDATE` only — no DELETE.

Payloads must be JSON-safe (dates as ISO strings, money as integer minor units or a
string): the `JsonPayload<P>` constraint refuses types JSON can't round-trip at
compile time on `defineApprovalKind`/`requestApproval`, and `requestApproval`
re-checks the runtime value with `isJsonSafe` before any DB access — a
`ValidationError`, no row, no audit row.

### 4.3 Field masking

Interface (`@fit/core/masking`):

```ts
type MaskPolicy<F> = { field: F; style: "last4"|"full"|"email"; unmaskPermission: Permission };

defineMaskedEntity<T>({ entityType, policies, load }): MaskedEntity<T>
mask<T, P>(record: T, policies: P): Masked<T, P[number]["field"]>
unmask<T>(db, actor, entity, { entityId, field, reason }): Promise<string | null>
```

`unmask` takes the `MaskedEntity` definition (not raw entityType/field strings) so the
permission and the row load come from the declared policy.

`mask` additionally refuses records containing unpoliced nested objects, arrays or
`unknown` fields — at compile time (`NestedKeys<T>` makes the field type `never`)
and at runtime (`ValidationError`). The rule fails closed: a new nested field can't
leak by default. `Date` fields are exempt; mask nested records separately and
combine them (see ADDING-AN-APP.md). `Masked<T>` keeps `null`/`undefined` on masked
fields.

## 5. UI kit (`packages/ui`)

Built once in A1 and reused by all three apps. The record components follow the
Power Apps model-driven patterns that ops staff already know (research R2-Q2): list
view → record form → command bar actions → timeline.

| Component | Purpose | R2-Q2 equivalent |
|---|---|---|
| `AppShell` | Left nav with icons (app sections), top bar with an account menu (signed-in user, sign-out) | Site map / navigator |
| `ListView` | The queue: columns, select rows, search, sort and filter, paging, with a `CommandBar` slot for actions on selected rows | List view |
| `CommandBar` | Row of actions for a list or a record (e.g. Assign, Approve, Reject) | Command bar |
| `RecordHeader` | Record title, status badge, owner and key fields | Form heading bar (status also stands in for the business process flow bar) |
| `Timeline` | Record history in one stream, newest first: audit events with who, when, what changed, reason | Timeline |
| `Button`, `Input`, `Table`, `Badge`, `EmptyState` | Base components | — |

Rules:

- Components are **presentational only**. They never decide what a user may do. A page
  passes in only the actions the server has already authorised, and every action's
  server action still calls `requirePermission`.
- `Timeline` reads from `audit_log` via a core query (`listAuditForEntity`). It shows
  masked values only (masking from A2).
- Styling is Tailwind CSS v4 with shadcn/ui conventions (`cva` variants, `cn()` helper,
  Radix primitives where a component needs behaviour, e.g. the `AppShell` account menu;
  icons from `lucide-react`). Tokens are shadcn-named CSS variables in
  `packages/ui/src/styles.css`, which also loads Tailwind and the Inter font. The palette is
  neutral ink on white with one subtle indigo accent. No logos.
- In A1 the audit viewer page uses `ListView`, and a demo record page under
  `(platform)` uses `RecordHeader`, `CommandBar` and `Timeline` with dummy data, so each
  component is exercised before the first business app.
- Kept minimal on purpose. The kit is based on Microsoft's docs, not the client's real
  apps. Add components when a real app needs them.

## 6. Known gaps (not in A1)

Out of A1 on purpose. Each needs its own decision.

| Gap | Why it matters | Planned |
|---|---|---|
| **DB-trigger audit on business tables** (with `SET LOCAL app.user_id`) | App-written audit misses raw SQL and code that skips `withAudit`; before/after values are only as good as the caller passes | Production hardening |
| **Tamper-evidence** (hash-chained audit rows, export to storage outside the DB) | An auditor can verify nothing was altered, even by the owner or a DBA | Production hardening |
| **Audit export** (CSV, admin-only, audited) | Research Q3: Dataverse has no native audit export | A2 or later |
| **Read audit for sensitive records** | Unmask reads are audited since A2 (`field.unmask`); ordinary reads of masked records are not | Later |
| **`Masked<T>` is compile-time only** | Casts/`any` bypass the brand; the backstops are REVIEW.md rule 3 and the `server-only` import | Accepted risk |
| **Timeline doesn't apply masking** | `apps/web` audit Timeline shows `before`/`after` JSON unmasked; apply `mask` when a real sensitive record uses it | With the first app that masks fields |
| **Stale roles** (idle timeout, shorter TTL or back-channel logout) | Removing someone's role in the IdP takes effect only at their next login | Before production |
| **Scheduled session cleanup** | `createSession` deletes a user's expired sessions when they sign in again; users who never come back keep one expired row (and its ID token) each | Before production |
| **Correlation ID on audit rows** | Trace one user action across rows and logs | Later |
| **Accessibility baseline** (keyboard, focus, labels; axe check in E2E) | Ops staff use these screens all day | Later |
| **Assign/ownership and bulk actions** | R2-Q2 Assign pattern; one audit row per record | With the first app that needs it |
| **Approval notifications** (email/Teams) | Replaces what Power Automate sends today | Later |
| **Dataverse data migration and cutover plan** | Probably the biggest hidden cost of replacing Power Apps | Separate plan |
| **Outbound integration allowlist; dev/test/prod; deploy pipeline** | Equivalent of Power Platform DLP and environments (research Q2) | Production |
| **Observability** (health check, error tracking, structured logs) | Running it in production | Production |
| **Real Entra ID test** | "Env vars only" is unproven without a tenant | Before production |
| **Single Next.js app** | One bad release affects all three apps; logic is in packages, so a split stays possible | Revisit if needed |

## 7. Ports and environment variables

| Service | Port |
|---|---|
| web (Next.js) | 3000 |
| Postgres | 5432 |
| Keycloak | 8080 |

| Variable | Used by | Local value (example) |
|---|---|---|
| `APP_URL` | web | `http://localhost:3000` |
| `DATABASE_URL` | web, tests (`app_runtime`) | `postgres://app_runtime:demo-only-change-me@localhost:5432/internal_tools` |
| `DATABASE_OWNER_URL` | migrate, seed, test setup (`app_owner`) | `postgres://app_owner:demo-only-change-me@localhost:5432/internal_tools` |
| `OIDC_ISSUER` | web | `http://localhost:8080/realms/internal-tools` |
| `OIDC_INTERNAL_ISSUER` | web in Docker only | `http://keycloak:8080/realms/internal-tools` |
| `OIDC_CLIENT_ID` | web | `internal-tools-web` |
| `OIDC_CLIENT_SECRET` | web | `demo-only-change-me` |
| `OIDC_ROLES_CLAIM` | web | `roles` |
| `OIDC_ALLOW_INSECURE_HTTP` | web | `true` locally; unset in production |
| `SESSION_TTL_HOURS` | web | `8` |
| `POSTGRES_PASSWORD` | Postgres container (superuser bootstrap) | `demo-only-change-me` |
| `KC_BOOTSTRAP_ADMIN_USERNAME` / `_PASSWORD` | Keycloak container | `admin` / `demo-only-change-me` |

All values above are fake and local-dev-only. `.env.example` is the source of truth.

Demo users (Keycloak realm `internal-tools`, password `demo-only-change-me`):
`analyst` (analyst), `approver` (approver), `admin` (admin), `norole` (no roles).

## 8. File tree (end state of the A1 PR)

```
.
├── AGENTS.md
├── README.md
├── .env.example
├── .gitignore
├── .nvmrc
├── .dockerignore
├── package.json                 # root scripts, packageManager, engines
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── vitest.config.ts             # vitest projects: packages/core, apps/web
├── docker-compose.yml
├── .devin/
│   └── blueprint.yaml
├── .github/
│   └── workflows/
│       └── ci.yml               # workflow "CI": jobs verify and e2e (both required)
│   └── CODEOWNERS               # packages/core, AGENTS.md, .devin/ → @tompritch30
├── infra/
│   ├── keycloak/
│   │   └── internal-tools-realm.json   # realm, client, roles, demo users
│   └── postgres/
│       └── init/
│           └── 01-roles.sql     # app_owner, app_runtime, database
├── apps/
│   └── web/
│       ├── Dockerfile
│       ├── package.json
│       ├── next.config.ts
│       ├── tsconfig.json
│       ├── playwright.config.ts
│       ├── proxy.ts             # route gating (Next 16 name for middleware)
│       ├── scripts/with-root-env.mjs   # loads the root .env for pnpm dev/start
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── globals.css
│       │   ├── login/page.tsx
│       │   ├── auth/
│       │   │   ├── login/route.ts
│       │   │   ├── callback/route.ts
│       │   │   └── logout/route.ts
│       │   └── (platform)/
│       │       ├── layout.tsx   # AppShell + requireUser
│       │       ├── page.tsx     # home: signed-in user and roles
│       │       ├── no-access/page.tsx
│       │       ├── audit/page.tsx   # admin-only, read-only audit viewer (ListView)
│       │       └── demo-record/
│       │           ├── page.tsx     # UI kit demo: RecordHeader, CommandBar, Timeline
│       │           ├── actions.ts   # "use server": addDemoNoteAction = defineAction(...)
│       │           └── note.ts      # testable logic: withAudit
│       ├── lib/
│       │   ├── auth.ts          # Next glue: cookies → core session/rbac, defineAction
│       │   └── prefetch.ts      # isPrefetchRequest
│       ├── test/
│       │   ├── proxy.test.ts            # unauthenticated → /login
│       │   ├── actions-use-define-action.test.ts
│       │   └── demo-note.test.ts         # write action → audit row
│       └── e2e/
│           └── login.spec.ts
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts           # everything except masking
│   │   │   ├── config.ts
│   │   │   ├── auth/oidc.ts
│   │   │   ├── session/session.ts
│   │   │   ├── session/cookie.ts    # cookie name (importable by proxy)
│   │   │   ├── rbac/permissions.ts
│   │   │   ├── rbac/guards.ts       # requireRole, requirePermission, access.denied audit
│   │   │   ├── rbac/denial.ts       # internal recordAccessDenied (not exported)
│   │   │   ├── rbac/define-action.ts
│   │   │   ├── approvals/approvals.ts  # defineApprovalKind, request/decide/cancel
│   │   │   ├── masking/masking.ts   # mask/unmask, server-only, `@fit/core/masking`
│   │   │   ├── audit/with-audit.ts
│   │   │   ├── audit/queries.ts     # audit viewer + listAuditForEntity (Timeline)
│   │   │   └── errors.ts            # + SelfApprovalError, ValidationError, ConflictError, NotFoundError
│   │   └── test/
│   │       ├── helpers/          # db.ts, env.ts, global-setup.ts (migrate + seed test DB)
│   │       ├── session.test.ts
│   │       ├── rbac.test.ts
│   │       ├── audit.test.ts
│   │       ├── audit-append-only.test.ts
│   │       ├── audit-writes-only-via-core.test.ts
│   │       ├── approvals.test.ts
│   │       ├── masking.test.ts
│   │       └── masking-types.test.ts
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── index.ts         # client factory
│   │   │   ├── schema.ts        # + approval_status enum, approval_requests
│   │   │   ├── migrate.ts
│   │   │   └── seed.ts
│   │   └── migrations/          # SQL files generated by drizzle-kit, plus custom SQL
│   │       │                    # 0002_approvals.sql, 0003_approvals_guard.sql
│   └── ui/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── styles.css       # Tailwind entry + design tokens (CSS variables)
│           ├── lib/cn.ts        # class-name helper (clsx + tailwind-merge)
│           └── components/  # AppShell, Button, Input, Table, Badge, EmptyState,
│                            # ListView, CommandBar, RecordHeader, Timeline
└── docs/
    ├── ARCHITECTURE.md
    ├── ADDING-AN-APP.md
    ├── DEVIN-LOG.md
    └── research/                # unchanged
```

`.gitignore` is replaced: the current file is a Python template, and the repo is
TypeScript.

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
| CI | GitHub Actions, one required job: `verify` |

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
  reviewed change to `packages/core`.
- A1 roles: `analyst`, `approver`, `admin`. A1 permissions: `platform:access` (any
  role) and `audit:read` (admin). A signed-in user with no role sees a "no access" page.

### 3.5 Audit write path

- `withAudit(tx, entry, fn)` runs `fn(tx)` and then inserts the audit row, **inside one
  database transaction** (a savepoint if `tx` is already a transaction). If the change
  or the audit insert throws, both roll back.
- Each row records: when, who (user id and IdP subject), action, entity type and id,
  before/after JSON, an optional reason, and request metadata.
- Login and logout also write audit rows (`auth.login`, `auth.logout`).

### 3.6 Append-only audit at the database level

- A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger on
  `audit_log` raise an exception. This blocks every role, including the owner.
- `app_runtime` (the role the app uses) has only `SELECT` and `INSERT` on `audit_log`.
  `UPDATE`, `DELETE` and `TRUNCATE` are revoked.
- A Postgres superuser can still disable triggers. In production, nobody uses a
  superuser at runtime, and the owner role isn't used by the app. Tamper-evidence
  (hash chaining) and export are later options, not in A1.

### 3.7 Database roles

| Role | Used by | Rights |
|---|---|---|
| `postgres` (superuser) | Container bootstrap only | Creates the two roles below and the database |
| `app_owner` | `pnpm db:migrate`, `pnpm db:seed` | Owns the schema; runs DDL and grants |
| `app_runtime` | The web app at runtime, server tests | CRUD on platform tables; **SELECT + INSERT only** on `audit_log` |

The roles are created by `infra/postgres/init/01-roles.sql`. Docker Compose runs it on
first start; CI runs the same file with `psql`.

### 3.8 Masking (A2 — design only)

- Masking runs **on the server, before data reaches the client**. Client components
  only ever receive masked DTOs.
- **No admin bypass.** The `admin` role gets no special case. (This closes the Dataverse
  gap in research Q3, where system administrators bypass column security.)
- Unmasking needs a permission **and** a non-empty reason, and writes a `field.unmask`
  audit row in the same transaction as the read.

## 4. `packages/core` scope

`packages/core` is the shared layer that all three business apps build on. It is the
only place these concerns are implemented.

| Module | What it provides | Built in |
|---|---|---|
| `auth` | OIDC client (PKCE), callback handling, logout URL | **A1** |
| `session` | Create, validate and revoke DB sessions | **A1** |
| `rbac` | Role → permission map, `requireRole`, `requirePermission` | **A1** |
| `audit` | `withAudit(tx, …)`, audit read query for the viewer | **A1** |
| `approvals` | Maker-checker approvals engine | A2 (design below) |
| `masking` | Field masking policies, `mask`, `unmask` | A2 (design below) |

### 4.1 Built and tested in A1

Each with a named test against real Postgres and a positive control:

- **OIDC login and session:** a seeded Keycloak user can log in end to end (Playwright),
  logout works, and unauthenticated requests are redirected to `/login`.
- **RBAC:** `requireRole` / `requirePermission` deny a user without the role, and allow
  a user with it.
- **Audit:** `withAudit` writes the change and the audit row together, and a failure
  rolls both back. As `app_runtime`, `UPDATE` and `DELETE` on `audit_log` fail;
  `INSERT` succeeds.

### 4.2 Approvals engine (A2 — design only)

Schema sketch:

```sql
create type approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table approval_requests (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,              -- e.g. 'refund.issue'
  subject_type  text not null,              -- e.g. 'refund'
  subject_id    text not null,
  payload       jsonb not null,             -- what will happen if approved
  status        approval_status not null default 'pending',
  requested_by  uuid not null references users(id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references users(id),
  decided_at    timestamptz,
  decision_note text,
  version       integer not null default 1, -- optimistic concurrency
  constraint maker_is_not_checker check (decided_by is null or decided_by <> requested_by)
);
```

Interface sketch:

```ts
requestApproval(tx, actor, { kind, subjectType, subjectId, payload }): Promise<ApprovalRequest>
decideApproval(tx, actor, { id, decision: "approve" | "reject", note, expectedVersion }): Promise<ApprovalRequest>
cancelApproval(tx, actor, { id, note }): Promise<ApprovalRequest>
```

Rules: the requester can never approve their own request (checked in code **and** by
the `CHECK` constraint). The approver needs the kind's approve permission. Only
`pending` requests can be decided. Every call writes its audit row through `withAudit`.

### 4.3 Field masking (A2 — design only)

Interface sketch:

```ts
type MaskPolicy = { field: string; style: "last4" | "full" | "email"; unmaskPermission: Permission };

mask<T>(record: T, policies: MaskPolicy[]): Masked<T>   // always masks; ignores role
unmask(tx, actor, { entityType, entityId, field, reason }): Promise<string>
  // requires unmaskPermission + non-empty reason; writes 'field.unmask' audit row
```

Policies are declared per entity in code, next to the app that owns the entity.

## 5. Ports and environment variables

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

## 6. File tree (end state of the A1 PR)

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
├── vitest.workspace.ts          # or vitest projects in vitest.config.ts
├── docker-compose.yml
├── .devin/
│   └── blueprint.yaml
├── .github/
│   └── workflows/
│       └── ci.yml               # workflow "CI": job verify (required), job e2e (optional)
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
│       │       └── audit/page.tsx   # admin-only, read-only audit viewer
│       ├── lib/
│       │   └── auth.ts          # Next glue: cookies → core session/rbac
│       └── e2e/
│           └── login.spec.ts
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts
│   │   │   ├── auth/oidc.ts
│   │   │   ├── session/session.ts
│   │   │   ├── rbac/permissions.ts
│   │   │   ├── rbac/guards.ts
│   │   │   ├── audit/with-audit.ts
│   │   │   └── errors.ts
│   │   └── test/
│   │       ├── helpers/db.ts
│   │       ├── session.test.ts
│   │       ├── rbac.test.ts
│   │       ├── audit.test.ts
│   │       └── audit-append-only.test.ts
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── index.ts         # client factory
│   │   │   ├── schema.ts
│   │   │   ├── migrate.ts
│   │   │   └── seed.ts
│   │   └── migrations/          # SQL files generated by drizzle-kit, plus custom SQL
│   └── ui/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── tokens.css       # CSS variables
│           ├── styles.css
│           ├── AppShell.tsx
│           ├── Button.tsx
│           ├── Input.tsx
│           ├── Table.tsx
│           ├── Badge.tsx
│           └── EmptyState.tsx
└── docs/
    ├── ARCHITECTURE.md
    ├── ADDING-AN-APP.md
    ├── DEVIN-LOG.md
    └── research/                # unchanged
```

`.gitignore` is replaced: the current file is a Python template, and the repo is
TypeScript.

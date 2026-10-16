# Security review — core and refunds

Attacker and malicious-insider review of `packages/core` (main at `c4d1c9c`) and the
refunds app ([PR #10](https://github.com/tompritch30/fintech-internal-tools/pull/10),
branch `devin/1792094615-refunds-app`, not yet merged). Done 2026-10-15 by Devin on a local
stack (Postgres, Keycloak, `pnpm dev`) with dummy data only.

**Method.** Source review of every guard on the attack path. The live probes ran as fresh
analyst and approver sessions against the running app, with raw HTTP replays of the
browser's server-action requests. Audit-row counts were read from Postgres before and after
each request. Tokens are redacted from all evidence. "Holds" means the attack failed. "Breaks"
means it worked. "Gap" means it held, but there is a weakness worth tracking.

**Control mappings** use the identifiers auditors usually ask about: SOC 2 Trust Services
Criteria (CC), ISO/IEC 27001:2022 Annex A (A.), PCI DSS v4.0 (PCI) and OWASP ASVS 4.0
categories (V). They show which control each finding is evidence for. They are not a
formal assessment.

## Summary

| # | Attack | Result | Fix |
|---|---|---|---|
| 1 | Open a record by ID without permission | Holds | — |
| 2 | Call server actions directly to skip checks | Holds | — |
| 3 | Unmask without a reason | Holds (gap: any non-empty reason passes); gaps closed by the hardening PR | — |
| 4 | Cross-site request forgery on actions | Holds | — |
| 5 | Privilege escalation through the IdP roles claim | Holds | — |
| 6 | Open redirect in the login callback | Holds | — |
| 7 | Session cookie settings | Holds (gaps: no idle timeout, no security headers); gaps closed by the hardening PR | — |
| 8a | Bypass the audit log: tamper with rows | Holds for the app role (gap: owner/superuser) | — |
| 8b | Bypass the audit log: denied access unrecorded | **Breaks** | [#19](https://github.com/tompritch30/fintech-internal-tools/pull/19) |
| 9 | Injection | Holds | — |
| 10 | Tamper with approval payloads | Holds | — |
| 11a | Race conditions in approvals and refunds | Holds | — |
| 11b | Split one refund to dodge approval | **Breaks** (found during the review) | [#18](https://github.com/tompritch30/fintech-internal-tools/pull/18) |
| 12 | Insider bulk-unmasking customer data (rate limit / alert?) | **Breaks**: no limit, no alert | [#17](https://github.com/tompritch30/fintech-internal-tools/pull/17) (core) |

Fix PRs (red test first, then fix):

1. [PR #17](https://github.com/tompritch30/fintech-internal-tools/pull/17): unmask rate limit — `packages/core`, needs Thomas's approval.
2. [PR #18](https://github.com/tompritch30/fintech-internal-tools/pull/18): refund split threshold — refunds app, merged into PR #10's branch, which is now on main.
3. [PR #19](https://github.com/tompritch30/fintech-internal-tools/pull/19): audit denied prefetch-header requests — `apps/web`. It reverses an A1 decision, so it is held for Thomas.

## Findings

### 1. Opening a record by ID without permission — holds

- **Attack:** a signed-in analyst, approver, user with no role, or no session at all browses to `/refunds/payments/<id>`,
  `/refunds/requests/<id>`, `/refunds/approvals` or `/audit` with guessed or copied IDs.
- **Evidence:**
  - Every page that reads data calls a server guard before the query:
    - `requirePageAnyPermission(["approvals:request","approvals:decide"], …)` on the payment, refund and list pages;
    - `requirePagePermission("approvals:decide", …)` on the queue;
    - `audit:read` on `/audit`.
  - No session → `proxy.ts` redirects to `/login`. Probe P4: `/refunds` returned 307 to `/login`, including with
    a forged `Host` header and both `x-middleware-subrequest` bypass spellings
    (the Next.js middleware-bypass CVE pattern).
  - Wrong role → 307 to `/no-access` plus an `access.denied` row. Probe P2: analyst on `/audit` gave +1 row.
  - Non-UUID IDs are rejected before the query, and unknown IDs give `notFound()`.
  - IDs are random UUIDs.
- **Note:** access is role-based by design: any refunds user can open any payment. There is no per-record
  ownership, because refunds is a back-office queue. Customer email stays masked in every
  view (see 3 and 12).
- **Controls:** CC6.1, CC6.3 · A.5.15, A.8.3 · PCI 7.2 · V4 (access control).

### 2. Calling server actions directly to skip checks — holds

- **Attack:** skip the UI and POST straight to the Next server-action endpoint. The goal is to
  reach an action the UI hides, or to send fields the form wouldn't.
- **Evidence:**
  - Every export of a `"use server"` file is built with `defineAction(permission, name, fn)`.
    `defineAction` loads the session on the server and calls `requirePermission` before `fn`. A test
    (`apps/web/test/actions-use-define-action.test.ts`) fails the build if an export isn't wrapped.
  - The business functions check again: `requestRefund` calls `requirePermission`,
    `decideApproval` checks `approvals:decide` and self-approval, and `unmask` checks `pii:unmask`.
  - Probe P1(f): the analyst's direct `revealEmailAction` POST was refused with
    `ForbiddenError: requires permission:pii:unmask`. No email came back, and one `access.denied` row was written.
  - Positive control P1(a): the same POST from an approver returned the email and wrote a `field.unmask` row.
- **Gap (low):** a refused action returns HTTP 500 rather than 403, because `ForbiddenError` is thrown
  outside the action's `try`. That's cosmetic: nothing leaks except the error name and message.
- **Controls:** CC6.1 · A.8.3, A.8.26 · V4.

### 3. Unmask without a reason — holds (gap)

- **Attack:** call `revealEmailAction` directly with no reason, or with whitespace only.
- **Evidence:**
  - Core `unmask` trims the reason and throws `ValidationError("unmasking requires a reason")`
    if it is empty. It does this *after* the permission check and *before* any data is read.
  - Probe P1(d2): reason `"   "` returned `{"error":"unmasking requires a reason"}`, with no email and no
    `field.unmask` row.
  - Positive control P1(d1): reason `"x"` returned the email and wrote one row, with reason `x`.
- **Gap:** any non-empty reason passes, so `"x"` satisfies the control. An auditor can't tell a real
  reason from a throwaway one. Requiring a ticket reference or a minimum length is a policy
  choice for Thomas, not a code defect. The rate limit in 12 bounds the damage either way.
- **Controls:** A.8.11 (data masking) · PCI 10.2.1 · CC7.2.

### 4. Cross-site request forgery on actions — holds

- **Attack:** a page on another origin submits a form, or calls `fetch`, at a server action or at
  `/auth/logout` while the victim is signed in.
- **Evidence:**
  - Next.js server actions compare `Origin` with `Host`. Probe P1(b): the same valid action request
    with `Origin: https://evil.example` returned 500 `Invalid Server Actions request.`, with no
    email and no `field.unmask` row.
  - The session cookie is `SameSite=Lax` (probe P3), so browsers don't send it on cross-site POSTs.
  - Logout is POST-only and checks `Origin === APP_URL` (`lib/same-origin.ts`, tested in
    `logout-origin.test.ts`).
- **Note:** a request with *no* `Origin` was accepted (P1(c)). Browsers always send `Origin` on
  cross-origin POSTs, so this isn't reachable cross-site. It needs the victim's cookie, which an
  attacker able to send it could use directly anyway.
- **Controls:** PCI 6.2.4 · A.8.28 · V4.2.2 / V13 (CSRF).

### 5. Privilege escalation through the IdP roles claim — holds

- **Attack:** get `admin` or `approver` by changing the `roles` claim. Ways to try: forge or modify a token,
  inject roles through the browser, or claim a role the app doesn't know.
- **Evidence:**
  - The ID token comes straight from Keycloak's token endpoint over the back channel, in exchange for the authorization code
    with PKCE S256. The browser never supplies claims. `openid-client` checks the issuer, audience and the nonce
    from the login cookie.
  - Probe P5: the token is `RS256` with a realm `kid`, `iss` is the realm, and `aud` is `internal-tools-web`.
    The analyst's `roles` was `["analyst"]`.
  - `syncUserFromClaims` keeps only roles that exist in the `roles` table and replaces the user's roles on each login.
    The test "replaces roles with the IdP's roles at login and ignores unknown roles" covers this.
  - The Keycloak realm has self-registration off, implicit and direct grants off, and roles come only from the
    realm-role mapper. Assigning realm roles needs Keycloak admin rights.
  - Admin holds no `approvals:decide` or `pii:unmask` (registry characterisation tests).
- **Gaps:**
  - Whoever administers the IdP controls every role. That's inherent: it's a control on Keycloak/Entra admin access.
  - Roles removed in the IdP stay valid until the session ends (up to `SESSION_TTL_HOURS`, 8 h by default).
    This is already listed in ARCHITECTURE.md Known gaps.
- **Controls:** CC6.2, CC6.3 · A.5.18, A.8.2, A.8.5 · PCI 7.2.

### 6. Open redirect in the login callback — holds

- **Attack:** get the app to redirect a victim to an attacker URL after login, e.g. through `next`, `returnTo` or `redirect_uri`.
  Alternatively, replay or forge the callback.
- **Evidence:**
  - `/auth/login` ignores query parameters. Probe P4: with `next`, `returnTo` and `redirect_uri` all set to
    `https://evil.example`, every response still sent `redirect_uri=http://localhost:3000/auth/callback`.
    Keycloak also allows only that exact redirect URI.
  - `/auth/callback` only ever redirects to `${APP_URL}/` or `${APP_URL}/login?error=login_failed`.
  - P4: the callback with no login cookie and the callback with a forged `fit_login` cookie both went to `login_failed`.
    State, nonce and PKCE verifier must all match the HttpOnly `fit_login` cookie (path `/auth`, 10 min).
  - Logout redirects to the IdP end-session URL built from the provider's metadata, then back to the fixed `/login`.
- **Controls:** A.8.5, A.8.26 · V3 / V5 (unvalidated redirects).

### 7. Session cookie settings — holds (gaps)

- **Evidence (P3, values redacted):**
  - `fit_session=…; Path=/; Expires=<+8h>; HttpOnly; SameSite=lax`
  - `fit_login=…; Path=/auth; Max-Age=600; HttpOnly; SameSite=lax`
  - The cookie value is 32 random bytes, and only its SHA-256 hash is stored (`session.test.ts`
    "stores only a hash of the session token").
  - Expiry is enforced on the server, and logout deletes the row ("logout revokes the session immediately").
- **Gaps (production hardening, not breaks):**
  - **Secure flag:** set only when `APP_URL` is `https://` (it was absent locally over http). Production must use an
    https `APP_URL`, so a startup check that refuses `http` outside development would enforce this.
  - **Cookie prefix:** no `__Host-` prefix. That would stop a sibling subdomain from setting the cookie.
  - **Idle timeout:** none, only an absolute 8 h lifetime. PCI 8.2.8 expects re-authentication after
    15 minutes idle for in-scope access. The refunds app only stores card last four, so PCI applicability
    is limited, but auditors will still ask.
  - **Security headers:** P3 found none of CSP, `X-Frame-Options`/`frame-ancestors`, HSTS, `Referrer-Policy` or
    `X-Content-Type-Options` on signed-in pages. `SameSite=Lax` keeps the session cookie out of cross-site
    iframes, which blunts clickjacking. A same-site sibling could still frame the app.
    Adding these headers in `next.config` is a cheap fix.
- **Controls:** A.8.5 · PCI 8.2.8, 4.2 · V3 (session management), V14.4 (headers).

### 8a. Tampering with the audit log — holds for the app role (gap)

- **Attack:** a malicious insider with the app's credentials, or with code merged into the app, edits or deletes
  audit rows, or writes fake ones.
- **Evidence:**
  - Migration 0001 grants the runtime role only `SELECT, INSERT` on `audit_log` and revokes `PUBLIC`.
  - Triggers reject UPDATE, DELETE and TRUNCATE, *including by the owner role*
    (`audit-append-only.test.ts`, five tests).
  - Business writes and their audit row commit in one transaction (`withAudit`).
  - A static test fails if code outside core writes to `audit_log`.
- **Gaps:**
  - A database superuser or owner can disable the triggers. There is no hash chain or export to
    write-once storage (ARCHITECTURE.md Known gaps).
  - The static test matches `.insert(auditLog` and `insert into audit_log`. Code using an alias such as
    `insert(schema.auditLog)` would slip past it, and the runtime role *can* insert. So a reviewer is the
    real control against forged rows: CODEOWNERS covers core, and `REVIEW.md` rule 2 covers apps.
- **Controls:** CC7.2 · A.8.15 · PCI 10.3.2 (protect logs from modification).

### 8b. Making denied access go unrecorded — **breaks**

- **Attack:** an analyst probing pages they shouldn't see adds `Sec-Purpose: prefetch` or
  `Purpose: prefetch` to each request. Access is still refused, but no `access.denied` row is written, so the
  probing leaves no trace.
- **Evidence:** probe P2, analyst `GET /audit`, each returning 307 to `/no-access`:

  | Header | `access.denied` rows added |
  |---|---|
  | none | +1 |
  | `Next-Router-Prefetch: 1` | +1 |
  | `Sec-Purpose: prefetch` | **+0** |
  | `Purpose: prefetch` | **+0** |

- **Cause:**
  - `apps/web/lib/auth.ts` `requirePagePermission` passes `isPrefetch: isPrefetchRequest(await headers())`
    to core, and core then skips the audit row. These headers are client-controlled.
  - A1 chose to skip prefetches to avoid false rows. But the layout only renders links the user can use, so real
    prefetch denials are rare, and the skip costs the control its evidential value.
- **Fix ([#19](https://github.com/tompritch30/fintech-internal-tools/pull/19), `apps/web` only):** always audit page denials, and update ARCHITECTURE.md to match.
  The red test sends each prefetch header as a denied user and expects one row. Its positive control is
  a permitted user with the same header: no row.
- **Controls:** CC7.2 · A.8.15, A.8.16 · PCI 10.2.1.4 (invalid access attempts).

### 9. Injection — holds

- **Evidence:**
  - All queries use Drizzle's query builder or `sql` tagged templates, which bind values as parameters.
    There's no `sql.raw` and no string-built SQL anywhere in `apps/` or `packages/`.
  - Sort columns come from fixed whitelists.
  - IDs are UUID-validated, and amounts are safe integers in pence.
  - Search terms are bound into `ILIKE '%…%'` as parameters. `%` and `_` aren't escaped, which only widens the
    user's own search. The existing test "serves a valid page for malformed page numbers and over-long searches" covers bad input there.
  - React escapes output, and there is no `dangerouslySetInnerHTML`.
  - Identity values from Keycloak (display name, email) are rendered as text. A user can edit their own display name in the Keycloak account console,
    which allows spoofing in the UI but no injection. The audit log records user IDs, not names.
- **Controls:** PCI 6.2.4 · A.8.28 · V5 (validation, sanitisation and encoding).

### 10. Tampering with approval payloads — holds

- **Attack:** an approver or requester changes the amount or payment of a refund after it was
  requested. Another try: approving the wrong request by posting another request's ID or version.
- **Evidence:**
  - The approve and reject forms send only `refundId`, `expectedVersion` and `note`. The server loads the refund, uses
    *its* linked approval ID, and on approval executes the refund row by `subjectId`. Nothing
    from the form decides what money moves.
  - Migration 0003's trigger rejects any change to a request's kind, subject, payload or requester, and any update to
    a decided request. Tests: "database rejects changing a pending request's requester or payload" and
    "database rejects updating a decided request".
  - Migration 0005 makes refund content immutable.
  - Deciding with another kind's definition is rejected ("rejects deciding with a different kind's definition").
  - Payloads must be JSON-safe, and the audit rows reference the request ID.
- **Controls:** CC8.1 · A.5.3 (segregation of duties), A.8.26.

### 11a. Race conditions in approvals and refunds — holds

- **Evidence:**
  - **Decisions:** a conditional `UPDATE … WHERE status='pending' AND version=expectedVersion` lets exactly one of two
    concurrent approvals win ("lets exactly one of two concurrent approvals win", "two approvers
    approving at the same time move the money once").
  - **Refunds:** each one locks its payment row (`SELECT … FOR UPDATE`) before computing what's left.
    The database backs this with the CHECK `refunded_pence <= amount_pence`, a trigger that refuses to re-process a
    succeeded refund, and a mock-provider ledger that is unique on `refund_id`.
  - Tests: "two people requesting at the same time can't over-refund", "a double-submitted
    request creates one refund", "the database refuses to re-process a succeeded refund".
- **Controls:** CC8.1 · A.8.26 · V11 (business logic).

### 11b. Splitting a refund to dodge approval — **breaks**

- **Attack:** an analyst refunds a £1,000 payment as four £250 refunds. Each one is at or under the £250
  threshold, so each goes straight through, and no second person ever approves £1,000.
- **Evidence:**
  - `requestRefund` decides with `input.amountPence > config.approvalThresholdPence`, per refund. It never
    looks at what this payment has already had refunded without approval.
  - The available-funds check stops only refunding more than the payment.
- **Fix ([#18](https://github.com/tompritch30/fintech-internal-tools/pull/18), refunds app):**
  - Refunds on one payment that skip approval may not total more than the threshold. Once a refund would take that total over, it
    needs a different approver.
  - The check runs under the payment row lock, so two parallel requests can't both
    slip under.
  - Tests: the second £200 refund goes to approval; positive controls: £200 then £50 go straight through, and
    another payment is unaffected; plus a concurrency test.
- **Residual:** an analyst can still refund many *different* payments under £250 each. Limiting each
  analyst's refund volume over time is a policy decision.
- **Controls:** A.5.3 (segregation of duties) · CC6.1 · V11.1 (business-logic limits).

### 12. Insider bulk-unmasking customer data — **breaks**: no rate limit, no alert

- **Attack:** an approver (who holds `pii:unmask`) scripts `revealEmailAction` across every payment
  ID to harvest customer emails.
- **Evidence:**
  - Probe P1(e) made 50 direct action calls with reason `x` over 50 different payments.
    Result: **50/50 emails returned in 0.999 s**, and the approver's `field.unmask` rows went from 3 to 53.
  - Searching `apps/` and `packages/` for rate limiting, throttling or alerting found nothing.
  - Each unmask is audited, so the harvest is recorded after the fact. But nothing slows it or tells anyone.
- **Fix ([#17](https://github.com/tompritch30/fintech-internal-tools/pull/17), `packages/core`, needs Thomas's approval):**
  - `unmask` allows at most `UNMASK_RATE_LIMIT` (20 per rolling 60 minutes) per user, counted from that
    user's `field.unmask` audit rows.
  - A per-user Postgres advisory lock is taken in the same transaction, so parallel calls can't overshoot.
  - Over the limit, the call is refused with `ForbiddenError` and an `access.denied` row
    (`required: unmask:rate-limit`).
  - Tests: the 21st call is refused and audited; positive controls: another user is unaffected and rows
    older than the window don't count; 25 parallel calls give exactly 20 successes.
- **Still a gap after the fix:**
  - No *alert*. The `access.denied` row with `unmask:rate-limit` is the event to alert on, but there is no
    SIEM or notification pipeline yet (observability is a known gap).
  - The limit is a fixed constant. Tuning it per role is for later.
  - Unmasking a non-existent ID writes no row, so enumerating IDs isn't audited. The UUIDs make guessing impractical.
- **Controls:** CC7.2, CC7.3 · A.8.11, A.8.16 · PCI 10.2.1.1 (access to cardholder data), 10.4 (log review).

## Out of scope / not tested

- Production IdP (Entra ID) configuration, network controls, TLS, hosting, secrets management.
- Dependency CVE scan (`pnpm audit`) and fuzzing.
- The KYC and feature-flag apps: reviewed separately, see [KYC and feature flags](#security-review--kyc-and-feature-flags) below.
- Denial of service, beyond noting there's no general rate limiting.

## Follow-up: hardening

The hardening PR requires unmask reasons to contain at least 10 characters after
trimming and adds the configurable `UNMASK_RATE_LIMIT_PER_HOUR` limit (default 20
per user per rolling hour). It sets the `__Host-` session cookie and a 15-minute
idle timeout. The proxy adds CSP with `frame-ancestors 'none'`, HSTS and the other
security headers.

Control mappings: PCI DSS 8.2.8 (idle timeout); OWASP ASVS V3 (session management:
cookie prefix and idle timeout); ASVS V14.4 (HTTP security headers); ISO 27001
A.8.5 (secure authentication); SOC 2 CC6.1.

Still open: real alerting; audit tamper by the database owner; the alias-dodge in
the audit-write test.

---

# Security review — KYC and feature flags

Attacker and malicious-insider review of the KYC app
([PR #22](https://github.com/tompritch30/fintech-internal-tools/pull/22)) and the feature-flags app
([PR #24](https://github.com/tompritch30/fintech-internal-tools/pull/24)), both on main at `3b3a239`.
Done 2026-10-16 by Devin against local Postgres (all migrations applied) with dummy data only.

**Method.** Source review of every guard on each attack path (pages, `actions.ts`, the domain
modules `kyc/kyc.ts` and `flags/flags.ts`, `flags/service.ts`, `api/flags/route.ts`, migrations
0008–0011). Then a throwaway probe suite ran the same domain functions the server actions call, as
fresh analyst, approver and analyst+approver users, against real Postgres, counting audit rows before
and after. Raw HTTP replays of server actions were not repeated: both apps' actions go through core's
`defineAction` (enforced by a static test), which part 1, finding 2 already probed over HTTP.
Same Holds / Breaks / Gap scale and control mappings as above.

## Summary

| # | Attack | KYC | Flags | Fix |
|---|---|---|---|---|
| K1 / F1 | Open a record by ID without permission | Holds | Holds | — |
| K2 / F2 | Call server actions directly to skip checks | Holds | Holds | — |
| K3 | Unmask without a reason | Holds | n/a (no masked fields) | — |
| K4 | Unmask beyond the rate limit | Holds | n/a | — |
| K5 / F5 | Self-approval (including one user holding both roles) | Holds | Holds | — |
| K6 / F6 | Tamper with approvals (version, payload, stale decisions) | Holds | Holds | — |
| K7 / F7 | Race conditions | Holds | Holds | — |
| K8 / F8 | Injection | Holds | Holds | — |
| K9 / F9 | Audit gaps | Holds (gap) | **Breaks**: refused service calls leave no trace | [#35](https://github.com/tompritch30/fintech-internal-tools/pull/35) |
| F10 | Service endpoint authentication | — | Holds (gap: one token for every environment) | — |
| F11 | Production kill switch | — | Holds (gap: approvers can't use it) | — |

Fix PRs (red test first, then fix):

1. [PR #35](https://github.com/tompritch30/fintech-internal-tools/pull/35): audit refused `/api/flags` calls, capped per minute (flags app only).

No KYC fix PR: no KYC attack worked. The KYC gaps below are tracked here, not fixed.

## Findings

### K1 / F1. Opening a record by ID without permission — holds

- **Attack:** a user with no KYC/flags role, or the wrong one, opens `/kyc/cases/<id>`,
  `/kyc/status/<status>`, `/flags/<id>` or `/flags/approvals` with copied IDs, or calls
  `getKycCase` / `revealCaseField` / `openCaseDocument` with another case's or document's ID.
- **Evidence:**
  - Every page that reads data calls `requirePagePermission` (`kyc:read`, `flags:read`,
    `flags:approve` for the approvals queue) before the query; a denial writes `access.denied`.
  - `revealCaseField` and `openCaseDocument` check `kyc:read` on the specific resource
    (`kyc_case:<id>`, `kyc_document:<id>`) before calling core `unmask`.
  - Non-UUID IDs are rejected before any query; unknown IDs give `notFound()` / `NotFoundError`
    (existing tests "rejects malformed and unknown ids").
  - Detail and list queries never select the raw masked columns; values reach the page already
    masked through `@fit/core/masking`.
- **Note:** access is role-based. Any `kyc:read` user can reveal PII on any case, including closed
  ones, within the unmask rate limit. There is no per-case need-to-know (gap, same design as refunds).
- **Controls:** CC6.1, CC6.3 · A.5.15, A.8.3 · V4.

### K2 / F2. Calling server actions directly to skip checks — holds

- **Attack:** replay a server action with a session that lacks the permission, or with forged fields
  (another user's case, a different environment, a stale version).
- **Evidence:**
  - All nine actions (`claimCaseAction`, `decideCaseAction`, `signOffCaseAction`, `revealFieldAction`,
    `openDocumentAction`, `changeFlagAction`, `killFlagAction`, `approveFlagChangeAction`,
    `rejectFlagChangeAction`) are `defineAction(permission, …)`; the static test enforces it.
  - The domain functions re-check on the server: KYC ownership runs under a row lock in `asOwner`
    and a non-owner gets an audited `kyc:case-owner` denial; flags check `flags:request` /
    `flags:approve`, the environment allow-list and a 0–100 integer rollout.
  - Probe: an approver calling `killFlag` → `ForbiddenError: permission:flags:request`.
- **Controls:** CC6.1 · A.8.3 · V4.1, V4.2.

### K3. Unmask without a reason — holds

- **Attack:** reveal a KYC field or open a document with an empty, blank or one-letter reason.
- **Evidence:** both paths call core `unmask`, which trims and requires at least 10 characters.
  Probe: reason `"x"` → `ValidationError: unmasking requires a reason of at least 10 characters`.
  Each reveal writes a `field.unmask` row with the reason.
- **Controls:** CC6.1, CC7.2 · A.8.11 · PCI 10.2.1.1.

### K4. Unmask beyond the rate limit — holds

- **Attack:** an approver bulk-reveals ID numbers and opens documents across many cases, alternating
  fields and documents to dodge a per-field limit.
- **Evidence:** probe ran 21 reveals on 21 different cases, alternating `idNumber` and document
  content. The first 20 succeeded and the 21st gave `ForbiddenError: unmask:rate-limit`. The budget is
  per user across fields, documents and apps (core counts every `field.unmask` row in the rolling
  hour under a per-user advisory lock), and the refusal is audited.
- **Gap:** still no alert to a human (part 1, finding 12, "still open").
- **Controls:** CC7.2 · A.8.11, A.8.16 · PCI 10.2.1.1.

### K5 / F5. Self-approval — holds

- **Attack:** one user holding both `analyst` and `approver` claims a high-risk (PEP / sanctions /
  high-rating) case, approves it, then signs off their own approval; likewise requests a prod flag
  change and approves it.
- **Evidence:** probes gave `SelfApprovalError: approval:not-requester` for both. Core `decideApproval`
  refuses when the decider is the requester. For KYC, the 0009 trigger also refuses to set a high-risk
  case to `approved` without an approved approval request, so the app can't skip the sign-off.
  Existing tests show a different approver succeeds (positive control).
- **Controls:** CC6.1, CC8.1 · A.5.3 (segregation of duties) · PCI 6.5.4.

### K6 / F6. Tampering with approvals — holds

- **Attack:** sign off with a forged or stale `expectedVersion`; approve a stale prod change after a
  kill to undo it; reject without a note; edit a pending change's contents.
- **Evidence:**
  - Probe: KYC sign-off with `expectedVersion + 5` → `ConflictError … changed since version`.
  - Probe: prod at 10 % on, an analyst requests 90 %, then kills the flag. Approving the 90 % request →
    `ConflictError: prod changed after this was requested`; prod stays off (version 2). A kill can't be
    undone by a stale approval.
  - Probe: reject with note `" "` → `ValidationError: rejecting an approval requires a note`.
  - The approval payload is built on the server from the locked row. The 0011 trigger makes
    `flag_changes` contents immutable and only allows `pending →` transitions; 0009 makes case
    content and documents immutable.
- **Gap (flags):** after a kill, the stale pending change blocks new prod requests for that flag until
  an approver rejects it. The requester can't cancel it. This is an operational nuisance, not a bypass.
- **Controls:** CC8.1 · A.8.32 · V11 (business logic).

### K7 / F7. Race conditions — holds

- **Attack:** two approvers sign off and reject the same case at once; two analysts claim the same case;
  a kill and an approval of a pending prod change land at the same moment.
- **Evidence:**
  - Probe: parallel approve + reject sign-off → one succeeded, the other got `ConflictError: no pending
    sign-off`; the case ended `approved` with one decision.
  - Concurrent claims are covered by the existing test (one wins, `FOR UPDATE` lock).
  - Probe: 10 rounds of parallel `killFlag` + `approveFlagChange` → every round ended with prod off and
    the stale approval refused. Both paths lock the prod `flag_values` row, and the version trigger
    allows +1 only.
- **Controls:** CC8.1 · V11.1.

### K8 / F8. Injection — holds

- **Evidence:** all queries use Drizzle with bound parameters; the only `sql` fragments are constants
  or parameters. The KYC search uses `ilike` with a bound value. IDs pass a UUID regex first, statuses
  and environments pass allow-lists, and `?environment=PROD` gives 400. React escapes notes,
  reasons and descriptions; there is no `dangerouslySetInnerHTML`.
- **Controls:** V5 · A.8.28.

### K9. KYC audit trail — holds (gap)

- **Evidence:** claim, decide (approve / reject / escalate), sign-off, reveal and document open each
  write an audit row in the same transaction; non-owner attempts write `access.denied`; KYC audit rows
  carry no PII (status, reference and risk flags only).
- **Gap:** an analyst who escalates a standard-risk case can claim it straight back (probe: `claimCase`
  after own escalation → ok). It doesn't bypass a control, because they could have decided it before
  escalating, and high-risk cases still need a second person. But "escalate" doesn't guarantee
  another analyst sees the case; the trail shows it.
- **Controls:** CC7.2 · A.8.15.

### F9. Refused calls to the flags service endpoint leave no trace — **breaks**

- **Attack:** an outsider, or an insider with a leaked or old token, guesses tokens against
  `GET /api/flags`. Every attempt is refused with 401, but nothing is recorded, so the guessing is
  invisible.
- **Evidence:** probe: 5 refused calls with wrong tokens → **+0** audit rows. This breaks AGENTS.md
  rule 6 ("A denial writes an `access.denied` audit row"), the same class as part 1, finding 8b.
- **Cause:** `handleFlagsServiceRequest` in `apps/web/app/(platform)/flags/service.ts` returned 401
  without calling anything else. Service callers aren't platform users, so core's
  `requirePermission` denial path never ran.
- **Fix ([#35](https://github.com/tompritch30/fintech-internal-tools/pull/35), flags app only):** a refused call
  writes `access.denied` on resource `api:flags` through `withAudit`, with no actor and
  `metadata: { required: "flags:service-token", token: "missing" | "invalid" }`. The presented token
  is never stored. The caller is unauthenticated, so rows are capped at 30 per minute (fixed window,
  counted under an advisory lock) to stop anyone flooding the append-only log. Past the cap the caller still
  gets 401. The row that reaches the cap is marked `capped: true`, and the refusals past it are counted and
  written as one `access.denied.suppressed` row per window (`metadata.suppressed`, `windowStart`, `windowEnd`),
  so the log stays bounded and refusals past the cap are still counted (Devin Review on #35 flagged that a silent cap would
  hide them; Thomas chose the summary row). The count is kept in memory until the window ends, so a crash
  inside a window loses that window's count (see [Known limitations](#known-limitations-kyc-and-flags), L1). The right token always works.
  Red tests: "records a refused service call as an access.denied row, without the presented token"
  (positive control: an accepted call writes no row) and "caps refused-call audit rows per minute,
  marking the row that hits the cap, so an unauthenticated caller can't flood the log" (positive control: the right token still works past
  the cap) and "when the cap is hit, writes one summary row per window with how many refusals it didn't record".
  A summary that can't be written stays queued for the next call and never blocks a valid read ("still serves a
  valid caller when a pending summary row can't be written, and writes it on a later call").
- **Controls:** CC7.2 · A.8.15, A.8.16 · PCI 10.2.1.4 (invalid access attempts).

### F10. Service endpoint authentication — holds (gap)

- **Attack:** call `/api/flags` with no token, a wrong token, the token plus a suffix, an empty bearer,
  a non-GET method, or no token configured; time the comparison.
- **Evidence:** 401 for every wrong or missing token, and 405 plus a GET-only route export for other
  methods (existing tests). It's switched off (503) when `FLAGS_SERVICE_TOKEN` is unset, and tokens
  under 16 characters are refused at load. The comparison is `timingSafeEqual` over SHA-256 digests,
  so it doesn't leak length or prefix. Responses are `no-store` and contain only key, enabled and
  rollout. Pending changes never show.
- **Gaps:**
  - One shared token reads every environment, so a dev or staging service holding it can read prod
    values. It's read-only and the values aren't sensitive. Per-environment tokens would be a config
    change.
  - No alert on a burst of refusals. The F9 rows give evidence, not detection.
- **Controls:** CC6.1, CC6.6 · A.5.17, A.8.5 · V2.10 (service authentication).

### F11. Production kill switch — holds (gap)

- **Attack:** use the kill switch to make an unapproved prod change (turn something *on*, or change
  rollout), skip the reason, or race it.
- **Evidence:** `isKill` only matches prod going enabled → disabled with the rollout unchanged.
  Anything else in prod goes to approval (existing tests). `killFlag` and the immediate path need
  `flags:request` and a reason, lock the prod row, bump the version and write `flag.killed` in the same
  transaction. The service endpoint reflects it on the next read. A stale approval can't undo it (F6),
  and races resolve to off (F7).
- **Gap:** only `flags:request` holders (analysts) can kill. An on-call user who holds only
  `approver` can't (probe: `ForbiddenError`). That's a policy choice to confirm, not a bypass.
- **Controls:** CC7.4 (incident response), CC8.1 · A.5.26.

## Known limitations (KYC and flags)

Thomas accepted these three for the pilot: each is a rare edge case, and fixing it properly needs a migration.
None of them lets a caller in or changes a flag. The worst case is a missing or split audit summary row.

| | What can happen | How likely | Migration that would fix it |
|---|---|---|---|
| **L1. A suppressed-refusal count is lost on restart** (F9, [#35](https://github.com/tompritch30/fintech-internal-tools/pull/35)) | Refusals past the 30-a-minute cap are counted in the worker's memory and written as one `access.denied.suppressed` row when the window ends. If that worker crashes, restarts or is redeployed before then, the window's count is never written. The first 30 `access.denied` rows and the `capped: true` row are already in the log, so the burst is still visible, but not how big it was. | Low. It needs more than 30 refused calls in one minute (already a sign of attack) and the worker stopping inside that same 60-second window. | A per-window counter table (for example `denied_audit_window`: `resource`, `window_start` as primary key, `suppressed`, `flushed_at`). Over-cap refusals add to the counter in the same transaction as the cap check, so the count survives a restart, and any worker writes the summary row for a window that has ended. |
| **L2. A window can have more than one summary row** (F9, #35) | Each worker keeps its own count, so N workers can write up to N summary rows for the same window. With one worker, a refusal that waits on the cap's advisory lock as the window closes can land after the summary was written, and gets its own small summary row with the same `windowStart`. No refusal is lost or counted twice. To get the total for a window, sum `metadata.suppressed` by `windowStart`. | Low. With one app process it needs a refusal in the last moment of a window that already hit the cap. With more processes it happens whenever more than one of them sees over-cap refusals in the same window. | The same counter table. A worker claims a window once (`UPDATE … SET flushed_at = now() WHERE flushed_at IS NULL RETURNING suppressed`) and writes exactly one summary row for it. |
| **L3. A seeded flag can miss its `flag.seeded` row** ([#40](https://github.com/tompritch30/fintech-internal-tools/pull/40)) | When the seed backfills a database seeded before #40, it treats a flag as its own only if the key and description match `SEED_FLAGS` (or it created the flag in that run). If the description no longer matches (the seed list was edited, or the row was changed in the database), that flag gets no `flag.seeded` row. Its history then starts at its first edit, or shows "No history yet". Its values and every later change are still audited. | Very low. It only affects databases seeded before #40 whose seed hasn't run since the description stopped matching. Every current `SEED_FLAGS` description matches its seeded row. | A provenance column on `flags` (for example `seeded boolean not null default false`, or a `created_by`) set by the seed. The backfill then keys on that instead of the description. |

## Out of scope / not tested (KYC and flags)

- Raw HTTP replays of the new server actions (see Method), browser-level e2e attacks, dependency CVEs.
- Real document storage and malware scanning: KYC documents are synthetic text in Postgres.
- Production token distribution and rotation for `FLAGS_SERVICE_TOKEN`.

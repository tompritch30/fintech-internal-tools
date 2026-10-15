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
| 3 | Unmask without a reason | Holds (gap: any non-empty reason passes) | — |
| 4 | Cross-site request forgery on actions | Holds | — |
| 5 | Privilege escalation through the IdP roles claim | Holds | — |
| 6 | Open redirect in the login callback | Holds | — |
| 7 | Session cookie settings | Holds (gaps: no idle timeout, no security headers) | — |
| 8a | Bypass the audit log: tamper with rows | Holds for the app role (gap: owner/superuser) | — |
| 8b | Bypass the audit log: denied access unrecorded | **Breaks** | Fix PR 3 |
| 9 | Injection | Holds | — |
| 10 | Tamper with approval payloads | Holds | — |
| 11a | Race conditions in approvals and refunds | Holds | — |
| 11b | Split one refund to dodge approval | **Breaks** (found during the review) | Fix PR 2 |
| 12 | Insider bulk-unmasking customer data (rate limit / alert?) | **Breaks**: no limit, no alert | Fix PR 1 (core) |

Fix PRs (red test first, then fix):

1. Unmask rate limit — `packages/core`, needs Thomas's approval.
2. Refund split threshold — refunds app, stacked on PR #10's branch.
3. Audit denied prefetch-header requests — `apps/web`. It reverses an A1 decision, so it is held for Thomas.

PR links are in the session's dev-log row ([DEVIN-LOG.md](DEVIN-LOG.md), row 16).

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
- **Fix (PR 3, `apps/web` only):** always audit page denials, and update ARCHITECTURE.md to match.
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
- **Fix (PR 2, refunds app):**
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
- **Fix (PR 1, `packages/core`, needs Thomas's approval):**
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
- The KYC and feature-flag apps (not built yet).
- Denial of service, beyond noting there's no general rate limiting.

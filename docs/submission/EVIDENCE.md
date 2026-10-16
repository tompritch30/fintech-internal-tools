# Evidence pack: what was built, how it was checked, what it cost

Draft for Thomas. Every figure below comes from this repo (merged PRs, review threads, commits, `docs/DEVIN-LOG.md`) on `main` at `256d725` (2026-10-15 23:12 UTC). Devin session records in this org were readable (title, start/end time, linked PRs), but their auto-summaries had not been generated, so decisions and problems are taken from the DEVIN-LOG rows those sessions wrote.

How the numbers were counted:
- **Lines**: `wc -l` of files tracked in the folder named (blank lines and comments included).
- **Tests**: `it(`/`test(` calls per file (`grep -cE '^\s*(it|test)\('`). Vitest's own total on the PR #30 branch was 327 tests in 22 files, because some files use `it.each`.
- **PR size**: GitHub additions/deletions, so tests, docs and lockfile changes are included.
- **Times**: UTC (BST = UTC+1). Merge times are from GitHub.

## 1. Summary

| | Platform (A1 + A2 + hardening) | Refunds | KYC | Feature flags |
|---|---|---|---|---|
| App code (lines) | core `packages/core/src` 1,113; db `packages/db/src` 659; ui `packages/ui/src` 651 | 1,102 | 1,087 | 1,004 |
| Server tests | 109 core + 19 web platform | 46 (`refunds.test.ts`, 542 lines) | 43 (`kyc.test.ts`, 491 lines) | 54 (`flags.test.ts`, 613 lines) |
| E2E tests (Playwright) | 2 (`login.spec.ts`) | 2 | 2 | 2 |
| Migrations | 0000–0003, 0007 | 0004, 0005, 0006 | 0008, 0009 | 0010, 0011 |
| Build PRs | #3, #4, #6, #7, #9, #15, #17, #19, #23 | #10, #18 | #22 | #24 |
| Review findings | 9 (A1 6, A2 3), 1 on #9; 3 security-review breaks (§3) | 2 on #10 (both fixed) | 1 on #22 | 0 threads on #24 |
| Devin cost | $33.87 | $23.94 | $7.30 | $8.26 |
| Thomas review time | Not logged | Not logged | Not logged | Not logged |

Web platform tests: `actions-use-define-action` 3, `demo-note` 2, `logout-origin` 3, `proxy` 9, `session-cookie` 2 (plus `auth-prefetch-audit`, which uses `it.each`). PR #30 added 9 more (`page-param` 6, `root-env` 3).

## 2. Per app

### Platform foundation (A1) and core (A2)

- **What**: login (Keycloak OIDC + PKCE, DB sessions), RBAC, append-only audit (`withAudit` + DB trigger), app shell, then maker-checker approvals and server-side field masking (A2).
- **PRs**: #3 A1 (+10,120/−215, 98 files), #4 governance + localhost-only ports, #6 UI restyle (Tailwind v4 + shadcn/ui), #7 A2 approvals + masking (+2,500/−63), #9 fixes for #7's review, #15 permission registry + `onRejected` hook, #17 unmask rate limit, #19 audit denials with prefetch headers, #23 security hardening.
- **Migrations**: `0000_init` (50 lines), `0001_audit_append_only` (27), `0002_approvals` (21), `0003_approvals_guard` (42), `0007_elite_hydra` (`sessions.last_seen_at` for the idle timeout, #23).
- **Decisions and problems** (DEVIN-LOG rows 6–15): the plan named `devlog.md` and Thomas corrected it to `DEVIN-LOG.md`; reading the live GitHub ruleset showed "branch up to date" was off, unlike the dictated setup (row 8), and Thomas fixed it in GitHub (row 9); Thomas added the `onRequested` hook so an app's record and its approval request commit in one transaction (row 12); #7 was merged with 3 review threads open, including a security finding, and Thomas made this a rule: **unresolved review threads block core merges** (row 13).

### Refunds (reference app)

- **What**: maker-checker refunds on core approvals; the customer email is masked and needs a reason to reveal.
- **PRs**: #10 (+4,856/−10, 32 files), #18 (stop splitting refunds under the approval threshold), #11 (the `new-internal-tool` playbook, written from this build).
- **Migrations**: `0004_refunds` (52 lines), `0005_refunds_guard` (51), `0006_refunds_rejected` (3).
- **Decisions and problems** (rows 16–17): ADDING-AN-APP said to add `refunds:*` permissions in core, but the brief ruled core out, so the first version reused `approvals:*`/`pii:unmask` and added a `senior` user to test self-approval. Traps recorded in the playbook: Drizzle ambiguous column, the Next route announcer's `role="alert"`, `server-only` in Vitest, missing Playwright browsers.

### KYC review queue (issue #12)

- **What**: claim → decide → sign-off queue for KYC cases, with masked documents.
- **PRs**: #22 (+4,469/−4, 24 files). Issue #12 closed with a link to #22.
- **Migrations**: `0008_kyc` (43 lines), `0009_kyc_guard` (98).
- **Decisions and problems** (row 20): the issue said to register `kyc:*` without touching `packages/core`, but the only registry is core's `PERMISSION_REGISTRY`. Devin followed the refunds convention and flagged it in the PR. The environment snapshot was incomplete and dependencies were installed by hand.

### Feature flags (issue #13)

- **What**: per-environment flag values, maker-checker for prod changes, a kill switch, and a service endpoint.
- **PRs**: #24 (+5,210/−7, 28 files). Issue #13 closed with a link to #24.
- **Migrations**: `0010_flags` (50 lines), `0011_flags_guard` (76).
- **Decisions and problems** (row 23): the same contradiction as KYC (`flags:*` "in the app permission registry", which is in core). Devin added the three permissions in their own commit and told Thomas mid-session.

## 3. Review findings and how each was fixed

Devin Review threads on merged PRs, as of 2026-10-15 23:15 UTC. All are resolved.

| PR | Kind | Finding | How it was handled |
|---|---|---|---|
| #3 | bug | Expired sessions pile up forever | Fixed in `b7d2786` (inside #3): `createSession` deletes the user's expired sessions |
| #3 | bug | Audit time sort used `id`, not `occurredAt` | Fixed in `b7d2786`: sorts by `occurredAt`, with `id` as the tie-breaker |
| #3 | security | Cross-origin form could force sign-out | Fixed in `b7d2786`: `/auth/logout` returns 403 unless `Origin` matches `APP_URL` |
| #3 | security | Demo services bound to public interfaces | Fixed in #4: Compose ports bound to `127.0.0.1` |
| #3 | bug | Host `db:migrate` ignored `DATABASE_OWNER_URL` in root `.env` | Judged non-blocking at the time; fixed in #30 (`loadRootEnv`) |
| #3 | bug | `?page=Infinity` broke the audit page | Judged non-blocking at the time; fixed in #30 (`parsePageParam` on all six list pages) |
| #7 | bug | Approval hooks get mis-typed payloads after the JSONB round trip | Fixed in #9: payloads must be JSON-safe |
| #7 | bug | `Masked<T>` dropped `undefined` from optional fields | Fixed in #9 |
| #7 | security | Nested sensitive data survived shallow masking | Fixed in #9: `mask` refuses nested values it has no policy for |
| #9 | bug | Approval payload loses present values (sparse arrays) | Fixed in `4165b90`; red test first in `00ff27a` |
| #10 | bug | Seeded payments have no audit rows | First left as setup data (Thomas agreed in the thread). Later fixed in a follow-up PR: the seed writes one `payment.captured` row per seeded payment (backfills, no duplicates on rerun, no name or email), and the payment page has a History section |
| #10 | security | Payment view shows customer names unmasked | Fixed in #10 before merge (`ca328ec`, `cb5de10`, `efd1b41`): core `name` mask style shows "Jane S."; `revealCustomerName` needs a reason and writes `field.unmask` |
| #21 | bug | Ruleset JSON weaker than the live ruleset (no `merge_queue` rule) | Confirmed as blocking and resolved before merge |
| #22 | security | Failed reveal could leave sensitive data on screen | Checked and not reproducible (`useActionState` replaces the state); code left as it is |
| #30 | bug | `MAX_PAGE = 10_000` made audit rows past page 10,000 unreachable | Fixed in #30 before merge (cap raised to 1e9); re-review found nothing |

Security review (`docs/SECURITY-REVIEW.md`, #16) tested 12 attacks. Three broke, and each was fixed in its own PR:

| Attack | Result | Fix |
|---|---|---|
| 8b. Make denied access go unrecorded | Broke | #19: denials are audited even with prefetch headers |
| 11b. Split a refund to dodge approval | Broke | #18: stop splitting refunds under the approval threshold |
| 12. Insider bulk-unmasking | Broke (50 emails in 1 s) | #17: 20 unmasks per user per hour, and the refusal is audited; #23 made the limit configurable and requires a reason of at least 10 characters |

Still open, per SECURITY-REVIEW.md: real alerting, audit tampering by the database owner, and the alias dodge in the audit-write test.

### Known limitations (accepted, no fix for the pilot)

Three review findings on [#35](https://github.com/tompritch30/fintech-internal-tools/pull/35) and [#40](https://github.com/tompritch30/fintech-internal-tools/pull/40) were confirmed and left on purpose. Thomas judged them rare edge cases not worth a migration for the pilot. The full write-up (what can happen, how likely it is, and the migration that would fix it) is in [SECURITY-REVIEW.md › Known limitations (KYC and flags)](../SECURITY-REVIEW.md#known-limitations-kyc-and-flags).

| | Limitation | Likelihood | Later fix (migration) |
|---|---|---|---|
| L1 | A worker restart inside a capped minute loses that window's `access.denied.suppressed` count. The first 30 `access.denied` rows and the `capped: true` row are still written. | Low | Per-window counter table, updated in the cap transaction |
| L2 | One window can get more than one summary row (one per worker, or a refusal that lands after its window was flushed). Counts add up correctly; sum by `windowStart`. | Low | The same table, with each window claimed once |
| L3 | If a seeded flag's description no longer matches `SEED_FLAGS`, a pre-#40 database doesn't get that flag's `flag.seeded` row backfilled. | Very low | Provenance column on `flags` (`seeded` / `created_by`) |

## 4. Build timeline (UTC, by merge time; 2026-10-15 unless marked)

| Time | What landed |
|---|---|
| 14 Oct 20:46 | #1 Power Apps build-vs-buy research (round 1) |
| 16:55 | #2 research round 2 |
| 17:08 | A1 session starts |
| 18:24 | #3 A1 platform foundation |
| 18:48 – 19:34 | #4 governance, #5 ruleset JSON, #8 blueprint fix |
| 19:23 | #6 UI restyle |
| 20:00 | #7 A2 approvals + masking |
| 20:24 | #9 #7 review fixes |
| 20:45 | #15 permission registry + `onRejected` |
| 21:16 | #18 refund-splitting fix |
| 21:21 | #10 Refunds app |
| 21:25 | #11 `new-internal-tool` playbook |
| 21:35 – 21:44 | #16 security review, #17 unmask rate limit, #19 denial audit |
| 22:08 | #23 security hardening |
| 22:13 | #21 merge-queue CI trigger |
| 22:20 | #22 KYC app |
| 22:25 – 22:59 | #25 README, #26 Marp deck setup, #27 submission pack, #29 draft deck |
| 22:39 | #24 Feature flags app |
| 23:12 | #30 PR #3 leftovers (safe `?page=`, root `.env`) |

From the start of A1 to the third app merging took about 5½ hours of wall-clock time (17:08 → 22:39), with sessions running in parallel.

## 5. Costs

From the Devin Usage page (cost per session), read on 16 Oct 2026 after the last submission sessions. The deck's A3 total ($132.27) and KEY-DECISIONS.md ("$132 including security review, QA and deck work") were read earlier that day, before the last two sessions finished. The per-app, platform, research, security review and UX lines match; only QA fixes and presentation and docs have grown since.

| Item | Sessions on the Usage page | Cost |
|---|---|---|
| Research (rows 1–4) | Research phase; Research round 2 | $4.58 |
| Platform A1 + A2 + hardening | Session A1; Build Prevals and Masking; Use DEVIN-LOG.md; Restyle Packages UI and App Shell; Add Merge Queue Support; Create KYC and Flag Issues | $33.87 |
| Refunds | Build Refunds Business App | $23.94 |
| KYC | Work on Issue #12 | $7.30 |
| Feature flags | Implement issue #13 with new-internal-tool | $8.26 |
| Security review | Audit Core and Refunds | $9.85 |
| UX polish | Standardize Refunds and KYC UI | $8.75 |
| Pre-flight and QA fixes | Fix Submission Blockers | $23.62 |
| Presentation and docs | Draft Power Apps Evaluation Docs; Build Marp Presentation Setup; Draft Submission Pack Docs | $39.22 |
| **Total** | 17 sessions | **$159.39** |
| Thomas review time, total | Not logged per PR; about <N> hours in total, including research, planning and the deck |

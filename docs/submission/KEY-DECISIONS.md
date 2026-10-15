# Key decisions

> **Draft for Thomas to rewrite.** One page. "Row N" = [docs/DEVIN-LOG.md](../DEVIN-LOG.md). Detail:
> [ARCHITECTURE](../ARCHITECTURE.md), [GOVERNANCE](../GOVERNANCE.md), [SECURITY-REVIEW](../SECURITY-REVIEW.md).

## What I built, and why that scope

The client spends about $250K a year on Power Apps (their figure) and asked whether to keep paying
or build. I wanted to answer with working software. I built a shared platform (sign-in,
permissions, audit, approvals, masking) and the two apps with the most to lose: refunds (money)
and KYC review (identity data). Feature flags was built and merged in PR #24, but my draft call is to
buy it: least regulatory risk, and products exist. I left out hosting, a real Entra tenant and data
migration so the time went on the controls an auditor checks.

## Key decisions and trade-offs

- **One shared core, one playbook.** Sign-in, permissions, audit, approvals and masking live once in
  `packages/core`; each app follows the `new-internal-tool` playbook, with refunds as the model.
  *Trade-off:* I review every core change, and all apps ship as one Next.js app, so one bad
  release hits all of them.
- **Controls enforced in the database.** Triggers make the audit log append-only, the app's role
  can only read and insert audit rows, a CHECK blocks approving your own request, and KYC keeps
  closed cases at least five years. A code bug can't switch these off. *Trade-off:* more SQL to
  review, and the owner role could still drop a trigger in a migration; nothing is tamper-evident yet.
- **Permissions registry in core.** One list of permissions and roles, changed only by a code
  owner, so grants can't drift. *Trade-off:* every app PR touches core and waits for me.
- **Drizzle, not Prisma.** Migrations are plain SQL, so a reviewer reads exactly what runs.
  *Trade-off:* a thinner tool with its own traps (row 16).
- **OIDC with PKCE; Keycloak stands in for Entra ID.** Moving to Entra should be configuration.
  *Trade-off:* unproven until it runs against a real tenant.
- **Strict "up to date" checks off.** With stale-approval dismissal, each merge made me re-approve
  every other open PR. *Trade-off:* a PR can merge on checks from an older `main`. A merge queue
  fixes that, but GitHub needs the repo to be organisation-owned (rows 19, 21).
- **Model by risk.** Fusion for core approvals and masking (rows 12–15); Normal for the platform
  plan, the UI and KYC; SWE-2 for flags, to trial it on a lower-risk app. The session API doesn't
  show the model, so I can't confirm SWE-2 ran (row 21).

## What's not production-ready

- No real Entra tenant, hosting, deploy pipeline, environments, monitoring or alerting.
- Audit rows are written by the app: no database-level audit of business tables, no hash chain,
  no export. A role removed in the identity provider only bites at the user's next sign-in.
- No Dataverse migration, no notifications, a mock card provider; KYC has no case intake or
  document upload. Merge queue off; flags unmerged; cost per app and review time unmeasured.

## Mistakes I own

- I merged core PR #7 with three review threads open, one a security finding. Fixed in #9; open
  threads now block core merges (row 13).
- I told the KYC and flags builds "don't touch core" after putting the registry in core (rows 14, 20).
- I turned strict checks on without thinking through approval dismissal (rows 9, 21), and a
  closing keyword in a PR body closed #17 and #19 by mistake (row 21).
- I passed on "$22" and "February 27" unsourced (rows 3–4) and described our GitHub settings
  wrongly from memory (row 8). Devin checked both against the sources.
- I didn't note billing per session: I have a running total ($74.48 on-demand, row 21), not a
  cost per app.
- Devin errors I had to catch: uncited numbers (row 1), seat maths on 200 users not 60 (row 4), a
  running total logged as one session's cost (row 7), merged PRs reported unmerged (row 18).

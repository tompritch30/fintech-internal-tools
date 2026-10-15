# REVIEW.md — what Devin Review must check on every PR

Flag any PR that breaks one of these rules. Each is also in [AGENTS.md](AGENTS.md).

1. **Every server action uses `defineAction`.** Every export from a `"use server"` file is
   built with `defineAction(permission, name, fn)` from `@fit/core`. No action checks
   permissions by hand or skips the check.
2. **Every business write goes through `withAudit`.** Every insert, update or delete on a
   business table happens inside `withAudit(tx, entry, fn)`, so the change and its audit
   row commit or roll back together. Nothing outside `packages/core/src/audit/` writes to
   `audit_log`.
3. **No masking bypass and no personal data reaching the browser.** Personal or
   sensitive fields are masked on the server before they reach a client component:
   no whole database rows passed as props, and no admin bypass. Unmasking needs a
   reason and writes an audit row.
4. **Every rule has a test with a positive control.** Each business or security rule has
   a named server-side test on real Postgres that asserts the rule, not internal calls.
   Every "is blocked" test has a matching "is allowed" test.
5. **App PRs never touch `packages/core`.** A PR that adds or changes a business app
   (KYC, refunds, feature flags…) must not modify `packages/core`. Core changes go in
   their own PR for code-owner review.

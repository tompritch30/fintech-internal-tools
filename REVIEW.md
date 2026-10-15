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
6. **UI follows the shared kit** ([.agents/skills/ui/SKILL.md](.agents/skills/ui/SKILL.md)).
   - **One record layout:** `RecordHeader` (title, status, owner), then one `ActionPanel`,
     then titled `RecordSection`s (Details, Documents, Decision, History).
   - **No one-off styling in app pages** beyond layout classes. Colours, borders, cards and
     badge or form styling come from `@fit/ui`; a new pattern becomes a `packages/ui` component.
   - **Never render an action the user can't take.** Actions come from a tested function that
     checks permission, state and business rules (e.g. no approving your own request). With no
     actions, `ActionPanel` shows a neutral waiting line. No disabled or always-refused buttons.
   - **Badges are neutral by default** via `StatusBadge`: red (`risk`) only for genuine risk
     such as high risk or a sanctions hit, green (`done`) only for completed. No `Badge tone` in app pages.
   - **Reveals use `RevealButton`** (one button, reason dialog), not inline reason boxes.

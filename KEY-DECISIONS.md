# Key decisions

Thomas Pritchard · Power Apps or build with Devin · Repo: https://github.com/tompritch30/fintech-internal-tools · Video: https://www.loom.com/share/17c212910537479ba3b874e62666115b

## The heart of the problem

Replacing Power Apps, the hardest part / the most important aspect of powerapps is the governance layer: Entra sign-in, data loss rules, Dataverse security and Microsoft's compliance scope. So the question is whether 10+ in-house tools can carry the controls a regulated fintech is audited on, for less than the roughly $275K a year Power Apps costs (from 2027) - whilst maintaining it forever. I treated the core platform as a fixed cost built once, and each tool as a small marginal cost on top, but the true cost will be getting to prod and maintaining it.

## Scope

Hence, I set up one core platform (sign-in, permissions, maker-checker approvals, masking, audit) and all three of the client's tools on it: refunds, KYC review and feature flags. It is production-shaped, not production-scale: sign-in, migrations, access control and audit are real; the identity provider, card provider and hosting are stand-ins behind a seam. I built all three tools, not one, first to show what devin can do at speed, and also to test if using a playbook would actually work.

For scope of POC things were left out on purpose, but set up to be easily configurable if the VP decided to shift to a devin rollout. We would need a real Entra tenant (Keycloak, uses the same OIDC), a real payment provider, hosting, the Dataverse migration and any visual builder. This rebuild/configuration step was scoped and presented as a key risk for the VP.

## Key decisions

1. **The database enforces the rules, not just the app.** So a constraint blocks approving your own request, triggers make the audit log append-only, and KYC cases are kept for at least 5 years. The app also connects as a least-privilege role, it can only read and insert audit rows and can't delete payments or refunds. E.g. a bug in tool 15 can't switch any of these off. Trade-off: more SQL to review, and the database owner could still change a trigger.
2. **Audit is written in the same transaction as the change.** If the audit write fails the action rolls back, so there's never a change without a record. Revealing masked data goes through the same path, it needs a reason and is capped at 20/hour/person.
3. **Masking happens on the server.** The masking code can't even be imported into browser code, so customer data only leaves the server when someone reveals it.
4. **One permissions registry, changed only by a code owner.** Every tool declares its permissions there and roles come from the identity provider at sign-in, so grants can't drift between tools. Trade-off: each new tool's permissions need/wait for that review.
5. **One web app for every tool.** A new tool is a folder on the core, not a new system to host and secure. Trade-off: one bad release hits all of them.

## Stack, and why

Mainstream on purpose: what a fintech can hire for and own, and what I thought Devin would likely know best (I hadn't used it much before this, so I went with the safe bet). It also fits their Microsoft set up: Entra uses OIDC and Azure runs managed Postgres. TypeScript and Next.js, with the checks and masking in server code. Postgres, because it can enforce the rules itself. Drizzle with plain SQL migrations, so a reviewer reads exactly what runs. OIDC sign-in with Keycloak standing in for Entra, so the switch is config, not code.

Tests run against a real Postgres, never a mocked one, and I capped end-to-end tests at 1-2 per tool. The rules live on the server and in the database, so that's where I tested them; browser tests are slow and flaky and would just check the same rules again through the screen - they would be necessary in prod, but not for POC scope. GitHub Actions with required checks on every PR. I kept myself as code owner on the core, migrations and CI, so Devin could merge ordinary tool PRs once green, but anything touching the controls needed me to sense check it first. Docker Compose runs the whole thing in one command.

## How Devin built it

I kept it to one session per task and corresponding pull request. I steered Devin through refunds myself, then got it to write a playbook from that session (`docs/playbooks/new-internal-tool.md`). KYC and flags were then one session each, using a GitHub issue pointing to the playbook I set up. I tracked costs in the usage tab: refunds $23.94, KYC $7.30, flags $8.26, core $33.87, so about $106 for the build. 

I then ran a separate Devin session purely to attack the build (`docs/SECURITY-REVIEW.md`). 4 attacks worked. The one that matters: my spec said refunds over £250 need a second approver, and Devin built exactly that, so £1,000 could go out as four £250 refunds with nobody approving. My spec was wrong, the code was faithful, and it was the security review that caught it, not the tests. It's now a running total checked under a row lock. The other three were bulk unmasking with no limit, and two kinds of refused request that left no audit trace. All 4 fixed before merge.

This would allow them to not have to write code, but just write specs and review outputs - decreasing their engineer time and delivery time - especially as this was all built in one evening.

I also explored differnt models on devin, using more powerful ones if more critical (Fusion for the core approvals and masking, Normal for most builds, SWE-2 I trialled out on flags), and overnight automations ran a second security review and an integration pass. Every session, prompt and cost I asked devin to write to `docs/DEVIN-LOG.md`.

## Things to improve / mistakes I made

- I merged a core pull request with a security thread still open. Open threads now block core merges, to prevent it next time.
- Removing someone's role in the identity provider only kicks in at their next sign-in.
- The audit log is append-only but not tamper-evident yet, there's no hash chain.

## Where I'm least confident

- **Whether the savings are real.** Licences only drop when a whole team stops using Power Apps, so if ops keep even one Power App those seats stay. The two-week discovery checks this against their licence report, to mitigate this before anything gets built, whilst getting to learn the customer's problems and what is required for a full build.
- **What ops lose.** Today ops change their own apps; after a build, every change becomes an engineering ticket. If they're changing things weekly, costs likely are higher.
- **Cost to review tools.** The £1,000 split only got caught because I attacked the build on purpose. There may be other issues, how many engineers will be need to make sure they are confident it is okay, then scaling that validation process to 10+ tools may be costly (as I assume 1 engineer's time)

Docs devin made (with my slides): `docs/DEVIN-LOG.md` · `docs/ARCHITECTURE.md` · `docs/SECURITY-REVIEW.md` · `docs/GOVERNANCE.md` · `docs/submission/EVIDENCE.md` · `docs/submission/deck.pdf`

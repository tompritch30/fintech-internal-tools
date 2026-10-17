# Key decisions

Thomas Pritchard · Power Apps or build with Devin · Repo: https://github.com/tompritch30/fintech-internal-tools · Video: https://www.loom.com/share/17c212910537479ba3b874e62666115b

## The question I answered

Building the screens is the easy part of replacing Power Apps. The real question for this client is whether thirteen tools built in-house can carry the controls a regulated fintech gets audited on, for less than the roughly $275K a year Power Apps will cost from 2027, without the owner becoming a bottleneck. So I built the controls first and the screens second.

## What I built, and what I left out

One shared platform (sign-in, permissions, maker-checker approvals, masking with a reason to reveal, an append-only audit log) and all three of the client's tools on top of it. I worked with Devin, back and forth, through refunds first, had it write a playbook from that session (in docs/playbooks), then built the KYC queue and flag admin from a GitHub issue and the playbook - each in their own session each. I built all three, not just one, so I could measure what the next tool costs.

I left out a real Entra tenant (Keycloak stands in), hosting, a real payment provider, the Dataverse migration and any visual builder. There isn't much benefit for POC.

## Key Decisions 

- **Key rules live in the database, not just the app.** A constraint blocks approving your own request, triggers make the audit log append-only, and KYC cases are kept five years. A bug in the next tool can't switch them off. Trade-off: more SQL to review, and the database owner could still drop a trigger.
- **Audit is written in the same transaction as the change**, so nothing happens off the record. Trade-off: an audit failure rolls the action back.
- **One permissions list, owned by one person.** Grants can't drift between tools. Trade-off: every new tool waits for that review, so the client needs a named owner.
- **One web app for all tools.** A new tool is a new folder, not a new system to host and secure. Trade-off: one bad release affects all 3.

## Stack, and why

It was the mainstream choices on purpose: they're what a fintech's engineers can hire for and own, and likely what Devin knows best.

- **TypeScript and Next.js.** Permission checks and masking run on the server, so customer data never reaches the browser unmasked.
- **Postgres**, because it can enforce the rules itself (constraints, triggers, row locks) and every cloud runs it managed.
- **Drizzle with plain SQL migrations**, so a reviewer reads exactly what runs against the database.
- **OIDC sign-in, with Keycloak standing in for Entra ID.** Same protocol, so moving to the client's Entra tenant should be configuration, not code.
- **GitHub Actions with required checks and code owners.** Nothing reaches main without passing tests, and changes to the platform core, database migrations or CI need my approval. Docker Compose runs the whole thing in one command.

## Devin costs

- Devin cost per tool: refunds $23.94 with me steering, then KYC $7.30 and flags $8.26 from the playbook. Shared platform $33.87. About $106 for the build, $132 including security review, QA and deck work. So I could show the cost effectiveness of using Devin and grounding for a VP presentation. I tracked it in docs/DEVIN-LOG.md

## Where Devin needed me

I ran a separate Devin session to attack the build. Four attacks worked. For example, my spec said refunds over £250 need a second approver, and Devin built exactly that, so an analyst could refund £1,000 as four £250 refunds with nobody approving. The security review caught it, but the tests didn't. The other three were bulk unmasking with no limit (now capped at 20 an hour) and two kinds of refused request that left no audit trace. All four were fixed before merge. Can see in SECURITY-REVIEW.md

I made a mistake when I merged a core pull request with a security thread still open, so I changed it so open threads block core merges to prevent that happening on core.

## Where I'm least confident

- The yearly running cost is an estimate, and mostly from the engineers' cost - likely would need more analysis for cost on infra etc.
- The playbook worked for 2 tools, but to be confident would need to iterate and test across at least 5.

## How I worked

Devin wrote all the code and opened all 43 pull requests - after Devin review. I collaborated with devin in ask mode to help build the architecture plan. I wrote the specs and reviewed the pull requests, and I approved every change to the core, migrations and CI; none merged without passing the tests. I didn't want many end-to-end tests as rules live on the server and in the database - browser tests are often slow and flaky and would check the same thing Overnight, scheduled Devin runs did a second security review and an integration test pass unattended. I even got devin to research html slide deck skills and scrape cognition styles, to have higher quality formatting for a VP, and can reuse the approach/skill later. I explored using fusion, normal and SWE-2 across different sessions too.

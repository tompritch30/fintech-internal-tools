# Key decisions

Thomas Pritchard · Power Apps or build with Devin · repo: tompritch30/fintech-internal-tools

## The question I answered

Devin can obviously build a refunds screen. The real question for this client is whether thirteen tools built in-house can carry the controls a regulated fintech gets audited on, for less than the roughly $275K a year Power Apps will cost from 2027, without the owner becoming a bottleneck. So I built the controls first and the screens second.

## What I built, and what I left out

One shared platform (sign-in, permissions, maker-checker approvals, masking with a reason to reveal, an append-only audit log) and all three of the client's tools on top of it. I steered Devin through refunds first, had it write a playbook from that session, then built the KYC queue and flag admin from a GitHub issue and the playbook, one session each. Three apps, not one, because the number that matters is the cost of the next app, not the first.

I left out a real Entra tenant (Keycloak stands in), hosting, a real payment provider, the Dataverse migration and any visual builder. Those are where a real build spends its time, and faking them would have flattered the estimate.

## Decisions I'd defend

- **Key rules live in the database, not just the app.** A constraint blocks approving your own request, triggers make the audit log append-only, and KYC cases are kept five years. A bug in the next tool can't switch them off. Trade-off: more SQL to review, and the database owner could still drop a trigger.
- **Audit is written in the same transaction as the change**, so nothing happens off the record. Trade-off: an audit failure rolls the action back.
- **One permissions list, owned by me.** Grants can't drift between tools. Trade-off: every new app waits for my review, which is the bottleneck I'd ask the client to staff.
- **One app, not one per tool.** Cheapest to run and review; one bad release hits all three.
- **Plain SQL migrations**, so a reviewer reads exactly what runs.

## What I measured

- Devin cost per app: refunds $23.94 with me steering, then KYC $7.30 and flags $8.26 from the playbook. Shared platform $33.87. About $106 for the build, $132 including security review, QA and deck work.
- 540 to 590 lines of business logic per app, 401 tests plus 8 end-to-end, 43 pull requests, all opened by Devin.
- The code got cheap fast. Owning it didn't, which is why the cost case rests on the engineer, not on Devin.

## Where Devin needed me

I ran a separate Devin session to attack the build. Four attacks worked. The best one: my spec said refunds over £250 need a second approver, and Devin built exactly that, so an analyst could refund £1,000 as four £250 refunds with nobody approving. The spec was wrong and the code was faithful; review caught it, the tests didn't. The other three were bulk unmasking with no limit (now capped at 20 an hour) and two kinds of refused request that left no audit trace. All four were fixed before merge.

That's the finding I built the recommendation on: Devin moves the constraint from writing code to writing specs and reviewing them. Also mine: I merged a core pull request with a security thread still open. Open threads now block core merges.

## Where I'm least confident

- The yearly running cost is an estimate, and the engineer share dominates it. I don't know their on-call load.
- The 2027 price rise comes from licensing advisors and a Message Center notice, not Microsoft's public price page.
- Two apps from one playbook aren't a curve. App four or five is the real test, hence a gate at each phase.

## How I worked

Devin wrote all the code in the repo. I wrote the specs, reviewed every pull request and approved merges. I used Claude for research, planning and help editing the deck. My own time was about [X] hours, over the 3 to 4 hour guide, plus overnight Devin runs; I'd rather say that than leave it to the commit timestamps.

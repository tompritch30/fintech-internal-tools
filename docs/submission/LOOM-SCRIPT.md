# Loom script

> **Draft for Thomas to rewrite.** Target: under five minutes, about 480 spoken words. Narrate
> over the five slides in [GHOST-DECK.md](GHOST-DECK.md) and the demo video. The video doesn't
> exist yet: the "Integration run (pre-approval)" automation is due to record a walkthrough of
> about 90 seconds (row 21 of the [dev log](../DEVIN-LOG.md)). The demo section is written to the
> planned click path; re-time it against the real video. Times are cumulative.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Title slide | Hi, I'm Thomas. You pay about $250K a year for Power Apps and asked whether to keep paying or build. I built a working answer with Devin. This is five slides and a short demo. |
| 0:15 | Slide 1 | First, the licence. Power Apps Premium is $20 a user a month, with unlimited apps. Your $250K buys about 1,042 seats, far more than your 60 engineers. Because it's per user, moving one app frees nothing. A seat only goes when everything that person uses has moved. And from February 2027, Microsoft blocks unlicensed users in managed environments, which could mean more seats, not fewer. |
| 0:50 | Slide 2 | So licences alone don't make the case. Controls do. For refunds and KYC, three things matter to an auditor. Stopping people approving their own requests: Microsoft doesn't publish a built-in check, so it's built and tested in every flow. Masking customer data: system administrators bypass it. Audit evidence: there's no native export. Power Apps can get there, but it's on whoever builds each flow. |
| 1:25 | Demo video (about 90 s) | Here's the build. I sign in through the identity provider; Keycloak stands in for Entra. As an analyst, I request a refund over the £250 threshold. The customer's email is masked on the server. Now as `senior`, who is both analyst and approver, I try to approve my own request, and it's refused. A different approver can approve it. Revealing the email needs a reason, and that reveal is audited. In KYC, an analyst claims a case; a high-risk approval waits for someone else to sign off. Finally, as admin, the audit log: every change, every reveal and every refusal, written in the same transaction. Admin can read it, but can't approve or reveal anything. |
| 3:00 | Slide 3 | Two things sit underneath that. The key rules are enforced by the database, not only the code: the audit log can't be edited, and nobody can approve their own request. And tests: refunds has 34 rule tests, 30 of them shown failing before the implementation. Then I attacked it: 12 areas, three attacks worked. Each got a failing test and a fix. |
| 3:30 | Slide 4 | Cost. Devin Teams seats for 60 engineers are $28,800 a year, 11.5% of today's spend. Devin's on-demand usage for this proof of concept, from research to the security review, was $74.48. What I haven't measured is the real constraint: engineer review time. Every app touches the shared core, so a person reviews every app. Hosting isn't costed either, so I'm not claiming a break-even yet. |
| 4:05 | Slide 5 | My recommendation: build refunds and KYC, where the controls matter. Keep the KYC Power App live until an auditor signs off. Buy feature flags; good products exist. Keep everything else on Power Apps for now, since extra apps there cost you nothing. Three next steps: test sign-in against a real Entra tenant, map which users use which apps, and measure review hours on the next app. |
| 4:40 | Slide 5 | The repo, the dev log and every source are linked below. Thanks. |

Sources behind each line: slides 1, 2, 4 and 5 as cited in [GHOST-DECK.md](GHOST-DECK.md); demo
behaviour from [README](../../README.md#demo-users), [ARCHITECTURE §4.2, §4.4, §4.5](../ARCHITECTURE.md)
and row 16 (the £250 threshold is the configurable default).

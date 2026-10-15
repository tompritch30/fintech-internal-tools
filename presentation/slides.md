---
marp: true
theme: consultancy
size: 16:9
paginate: true
header: Cognition · Draft
title: Power Apps or build with Devin (draft)
---

<!--
DRAFT DECK, first pass. Storyline from docs/submission/GHOST-DECK.md; evidence from
docs/EVALUATION.md (draft, PR #20), docs/research/research.md [S#] and docs/DEVIN-LOG.md (row N).
Rules: .agents/skills/slides/SKILL.md. Unsourced numbers are [bracketed placeholders].
-->

<!-- _footer: "Source: $250K client-supplied; $20/user/month list price [S1]; Feb 2027 [S16]" -->

# Power Apps bills per user, so moving one app frees no seats

- $250K is about 1,042 seats at $20 a month
- More apps cost licensed users nothing extra
- Feb 2027: unlicensed users get blocked

<div class="visual flow"><div>Uses 3 apps<br>Pays 1 seat</div><div>2 apps move<br>Still pays</div><div>All 3 move<br>Seat freed</div></div>

<!--
DRAFT.
VP question: If we build our own apps, do we stop paying $250K?
What I'll say: Premium is per user with unlimited apps, so the licence saving isn't automatic.
A seat is only freed when every app that person uses has moved. 1,042 = $250,000 ÷ ($20 × 12),
far more than the 60 engineers, so most users aren't engineers. That assumes the whole $250K is
Premium seats at list price (ASM-1). From February 2027, people using apps in managed
environments without Premium get blocked [S16], which could mean more seats, not fewer.
-->

---

<!-- _footer: "Source: Microsoft Learn [S3] [S5] [S18]; EVALUATION §5" -->

# On refunds and KYC, Power Apps leaves the key controls to us

| Control | Power Apps | What we must add |
|---|---|---|
| No self-approval | No built-in check; requester is free text [S18] | Build and test it in every flow |
| Masking customer data | System admins bypass column security [S5] | Accept that admins see it |
| Audit evidence | Change history kept, no native export [S3] | Pull it through the API |

<!--
DRAFT.
VP question: Why not keep everything on Power Apps?
What I'll say: these are the controls an auditor asks about for money movement and identity data.
Power Apps can get there, but each is left to whoever builds the flow, and the admin bypass on
masking can't be configured away. Non-delegable queries also look at only the first 500 rows
(2,000 at most) and return wrong results without an error [S2].
-->

---

<!-- _footer: "Source: DEVIN-LOG rows 16, 18; docs/SECURITY-REVIEW.md" -->

# Devin built refunds and KYC with controls the database enforces

- No self-approval: checked in code and by a database rule
- Refunds: 34 rule tests, 30 shown failing first
- Attack review: 3 of 12 areas broke; each fixed with a test

<div class="visual placeholder">[Screenshot: demo still, the senior user refused when approving their own refund. Video not recorded yet]</div>

<!--
DRAFT.
VP question: Does it work, and can we trust code Devin wrote?
What I'll say: sign-in through an identity provider, permission checks on the server, an audit
row in the same transaction as every change, and a database that refuses to edit or delete audit
rows. Data is fake, Keycloak stands in for Entra. Every control is self-built, so assurance comes
from our tests and reviews. The hostile review broke three things: bulk unmasking, splitting a
refund to dodge approval, and unrecorded denials. Each got a failing test and a fix.
-->

---

<!-- _footer: "Source: $40/seat/month [S21] [S22]; $250K client-supplied; $74.48 DEVIN-LOG row 21" -->

# Devin seats cost 11.5% of today's spend; review time is the open cost

- 60 Teams seats: $28,800 a year
- Whole proof of concept, on-demand: $74.48
- Usage, review hours, hosting: [not measured]

![Cost per year: Power Apps licences versus Devin seats; other costs not measured](assets/charts/cost.svg)

<!--
DRAFT.
VP question: What does the build path cost us?
What I'll say: 60 × $40 × 12 = $28,800; $28,800 ÷ $250,000 = 11.5% (EVALUATION §3.4). Usage past
the plan quota is billed at API pricing and the rate isn't published [S21], so measured spend is
the best evidence: $74.48 on-demand across every session up to row 21, not split per app. The
scarce input is engineer review time; I haven't measured it, and hosting isn't costed. No
break-even claim.
-->

---

<!-- _footer: "Source: EVALUATION §7; LaunchDarkly [S13]; Unleash [S14]" -->

# Build refunds and KYC, buy feature flags, keep the rest on Power Apps

| App | Decision | Before we switch off the Power App |
|---|---|---|
| Refunds | **Build** (built) | Ops sign off a parallel run |
| KYC review | **Build** (built) | An auditor accepts five-year retention |
| Feature flags | **Buy** | Price LaunchDarkly or Unleash |
| All other apps | **Keep** | List which users use which apps |

<!--
DRAFT.
VP question: What should I decide today?
What I'll say: the case for building is controls, not licences. Low-risk apps cost nothing extra
to keep on Premium. KYC records are kept five years after the relationship ends [S11] [S12]; an
auditor must accept our retention guard before cut-over. We did build flags (PR #24) to trial
SWE-2 on a low-risk app, but with mature products available I'd still buy.
Next steps are in the appendix.
-->

---

<!-- _class: appendix -->
<!-- _footer: "Source: docs/research/research.md; docs/DEVIN-LOG.md" -->

# Appendix: every number in the deck comes from these sources

| Ref | Source | Used on |
|---|---|---|
| S1, S20 | Microsoft, Power Apps pricing and licensing FAQ | 1, 4 |
| S3, S5, S18 | Microsoft Learn: auditing, column security, Approvals connector | 2 |
| S16 | Microsoft Learn: managed environment licensing | 1 |
| S21, S22 | Cognition: Devin pricing and self-serve billing | 4 |
| S11, S12, S13, S14 | 31 CFR 1020.220; UK MLR 2017 reg. 40; LaunchDarkly; Unleash | 5 |
| Client | $250K a year on Power Apps; about 60 engineers (not verified) | 1, 4 |
| Our log | Devin spend $74.48 (row 21); tests and reviews (rows 16, 18) | 3, 4 |

<!--
DRAFT. Only if asked. Full URLs and quotes are in docs/research/research.md.
-->

---

<!-- _class: appendix -->
<!-- _footer: "Source: EVALUATION §3; [S1] [S21] [S22]; DEVIN-LOG row 21" -->

# Appendix: what we know about cost, and what is still a placeholder

| Line | Value | Working |
|---|---|---|
| Implied Power Apps seats | ≈1,042 | $250,000 ÷ ($20 × 12) |
| Devin seats, 60 engineers | $28,800/year | 60 × $40 × 12 |
| Devin on-demand to date | $74.48 | Billing running total, row 21 |
| Devin cost per app | [not measured] | Needs a per-session billing split |
| Review hours per app | [not measured] | Thomas to log |
| Hosting per year | [not costed] | Not researched |

<!--
DRAFT. Show the arithmetic if asked. Break-even can't be stated until the bracketed lines are filled.
-->

---

<!-- _class: appendix -->
<!-- _footer: "Source: docs/SECURITY-REVIEW.md §8b, §11b, §12; DEVIN-LOG row 18" -->

# Appendix: our own attack review broke three controls, now fixed

| Attack | What broke | Fix (PR) |
|---|---|---|
| Bulk unmasking | 50 of 50 emails revealed in 1 second | 20 reveals per hour per user (#17) |
| Refund splitting | £1,000 refunded as four £250 refunds, no approver | Unapproved total per payment capped (#18) |
| Hiding denials | A prefetch header skipped the denial audit row | Every page denial audited (#19) |

<!--
DRAFT. Only if asked. Also: a core PR merged with a security finding still open (row 13); it was
fixed and open review threads now block core merges.
-->

---

<!-- _class: appendix -->
<!-- _footer: "Source: EVALUATION §7, §8" -->

# Appendix: three things to do before the next app

1. Test sign-in against a real Entra tenant (owner: [TBD])
2. Map which users use which apps (owner: [TBD])
3. Measure review hours and Devin cost per app (owner: [TBD])

<!--
DRAFT. Each step closes an open item in EVALUATION §8.
-->

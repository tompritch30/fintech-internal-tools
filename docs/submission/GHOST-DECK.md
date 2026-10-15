# Ghost deck

> **Draft for Thomas to rewrite.** Audience: the client's VP of Engineering. Five slides; the
> titles alone should tell the story. Evidence: `docs/EVALUATION.md` (draft, PR #20, cited as
> "EVAL §N"), [research](../research/research.md) ([S#]) and the [dev log](../DEVIN-LOG.md)
> ("row N"). Client-supplied figures are marked as such. Slide rules (one-line titles, at most
> three bullets, one visual, a source on every number) follow `.agents/skills/slides/SKILL.md`
> from PR #26.

## Storyline (titles only)

1. Power Apps bills per user, so moving one app frees no seats
2. On refunds and KYC, Power Apps leaves the key controls to us
3. Devin built refunds and KYC with controls the database enforces
4. Devin seats cost 11.5% of today's spend; review time is the open cost
5. Build refunds and KYC, buy feature flags, keep the rest on Power Apps

---

## 1. Power Apps bills per user, so moving one app frees no seats

**Question it answers:** If we build our own apps, do we stop paying $250K?

**Visual:** one diagram. A user holding one Premium seat, with lines to three apps. Two apps
moved off: seat still paid. All three moved: seat freed.

**On the slide:**
- $250K buys about 1,042 seats at the $20 list price
- Each extra app costs licensed users nothing more
- From February 2027, unlicensed users are blocked in managed environments

Source: $250K client-supplied; $20/user/month and "no limit to the number of apps" [S1];
1,042 = $250,000 ÷ ($20 × 12), research Q1; February 2027 [S16].

**Speaker notes:** Premium is per user with unlimited apps, so the licence saving isn't automatic.
A seat is only freed when every app that person uses has moved. 1,042 seats is far more than
your 60 engineers, so most users aren't engineers, and we don't yet know which of them use
which apps. That assumes the whole $250K is Premium seats at list price; Dataverse capacity,
other products or discounts would lower the seat count (ASM-1). One upward risk: from February
2027, people using apps in managed environments without a Premium licence get blocked, which
could mean more seats, not fewer. A $22 price from January 2027 appears only in a secondary
source [S28], so I've kept it off the slide.

---

## 2. On refunds and KYC, Power Apps leaves the key controls to us

**Question it answers:** Why not keep everything on Power Apps?

**Visual:** a three-row table: control, what Power Apps does, what we'd have to add.

| Control | Power Apps | Gap |
|---|---|---|
| No self-approval | Not published; `Requestor` is optional free text [S18] | Build and test it in every flow |
| Masking customer data | Column security, but system admins bypass it [S5] | System admins see masked data |
| Audit evidence | Change history kept, no native export [S3] | Pull it through the API |

Source: Microsoft Learn [S3] [S5] [S18]; EVAL §5.

**Speaker notes:** These are the controls an auditor asks about for money movement and identity
data. Power Apps can get there, but each one is left to whoever builds the flow, and the admin
bypass on masking can't be configured away. There's also a correctness trap: queries that can't
be delegated look at only the first 500 rows (2,000 at most) and return wrong results without
an error [S2]. For low-risk apps none of this matters much. For refunds and KYC it's the whole
question.

---

## 3. Devin built refunds and KYC with controls the database enforces

**Question it answers:** Does it work, and can we trust code Devin wrote?

**Visual:** one still from the demo video: the `senior` user refused when approving their own
refund.

**On the slide:**
- No self-approval: checked in code and by a database rule
- Refunds: 34 rule tests, 30 shown failing first
- Our attack review: 3 of 12 attack areas broke; each fixed with a test

Source: rows 16, 18; [SECURITY-REVIEW](../SECURITY-REVIEW.md); [ARCHITECTURE §4.2, §4.5](../ARCHITECTURE.md).

**Speaker notes:** What you're seeing is real: sign-in through an identity provider, permission
checks on the server, an audit row in the same transaction as every change, and a database that
refuses to edit or delete audit rows. Customer data is masked on the server with no admin bypass;
revealing a field needs a reason, is rate-limited and is audited. The data is fake, Keycloak
stands in for Entra, and the card provider is a mock. On trust: every control here is self-built,
so its assurance comes from our tests and reviews, not a vendor attestation. I ran a hostile
review. Three attacks worked: bulk unmasking, splitting a refund to dodge approval, and
unrecorded denials. Each got a failing test and a fix. Separately, I merged a core change with a
security finding still open; it was fixed, and open review threads now block core merges.

---

## 4. Devin seats cost 11.5% of today's spend; review time is the open cost

**Question it answers:** What does the build path cost us?

**Visual:** one bar chart, a year at a time. Power Apps today $250,000. Devin seats for 60
engineers $28,800. Devin usage per app, engineer review time and hosting drawn as dashed "TBD"
bars.

**On the slide:**
- 60 Teams seats: $28,800 a year
- Devin on-demand spend for this whole proof of concept: $74.48
- Review hours, cost per app and hosting not measured yet

Source: $40/seat/month [S21] [S22]; 60 × $40 × 12 = $28,800; $28,800 ÷ $250,000 = 11.5%
(EVAL §3.4); $74.48 per the Devin billing page (row 21); 60 engineers client-supplied.

**Speaker notes:** The seat cost is small next to the licence bill, but it isn't the full cost.
Usage past the plan quota is billed at API pricing, and the rate isn't published [S21], so our own
measured spend is the best evidence: $74.48 on-demand for every session up to about 22:00 UTC
on 15 October (research, platform, refunds, KYC, security review and fixes). That excludes the
plan fee and later sessions, and I didn't split it per app, so it's a running total, not a
per-app figure. The scarce input is engineer review time: every app touches the shared core, so a code
owner reviews every app PR. I haven't measured those hours yet, and hosting hasn't been costed.
So I'm not claiming a break-even; I'm showing which numbers we still need.

---

## 5. Build refunds and KYC, buy feature flags, keep the rest on Power Apps

**Question it answers:** What should I decide today?

**Visual:** a four-row table: app, call, condition.

| App | Call | Condition |
|---|---|---|
| Refunds | Build (done) | Run beside the Power App until ops sign off |
| KYC review | Build next | Keep the Power App live until parity and auditor sign-off |
| Feature flags | Buy or self-host | LaunchDarkly [S13] or Unleash [S14]; pricing not researched |
| Everything else | Keep | Inventory apps and users first |

**On the slide:**
1. Test sign-in against a real Entra tenant (owner: TBD)
2. Map which users use which apps, to size real seat savings (owner: TBD)
3. Measure review hours and Devin cost on the next app (owner: TBD)

Source: EVAL §7; [S13] [S14].

**Speaker notes:** The case for building is controls, not licences: refunds and KYC are where
Power Apps leaves self-approval and admin access to PII to us. Low-risk apps cost nothing extra to
keep on Premium, so I wouldn't move them yet. KYC records must be kept five years after the
relationship ends [S11] [S12]; the database keeps closed cases at least five years, but an auditor
has to accept that before cut-over. On flags: we did build one (PR #24) to trial Cognition's SWE-2 model on a low-risk app, but with
mature products available I'd still buy. If we say no to building, the controls on slide 2 still
have to be built and tested inside each Power Automate flow.

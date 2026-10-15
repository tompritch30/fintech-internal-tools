# Evaluation: Power Apps vs building internal tools with Devin

> **DRAFT for Thomas to rewrite.** Audience: the client's VP of Engineering.
> **Evidence used:** only [`docs/research/research.md`](research/research.md) (sources S1–S31, cited as [S#]), [`docs/research/requirements.md`](research/requirements.md) (all of it is marked HYPOTHESIS), and [`docs/DEVIN-LOG.md`](DEVIN-LOG.md) (cited as "Log row N").
> **Rules:** every number is sourced or shown as arithmetic on sourced numbers. Anything else is labelled **ASSUMPTION (ASM-n)** or **not published / not measured**. No estimates are filled in where the evidence is missing; those are left as named variables.

---

## 1. Summary

- **Today:** the client reports **$250,000/year** on Power Apps (client-supplied, not sourced). At the $20.00 Premium list price [S1] that implies **≈1,042 seats**, far more than the ~60 engineers, so most users are not engineers (research Q1).
- **2027:** a secondary source reports Premium rising **$2/user/month from 1 January 2027**, at renewal [S28]. No Microsoft primary source was found publicly; $20.00 remains the sourced price [S1] [S20]. Separately, from **February 2027** unlicensed users are blocked from apps in managed environments [S16].
- **Devin:** published seat cost for the ~60-engineer team on Teams is **$28,800/year** [S21] [S22]. Usage past quota is **not published** [S21] [S23]; the per-app usage figure has to come from our own log, and **the per-app cost for refunds hasn't been recorded in the log yet** (section 3.2).
- **Draft recommendation:** **Build** refunds (already built on the shared platform), **Build** the KYC review queue next while keeping the Power App live until parity and auditor sign-off, **Buy** (or self-host OSS) feature flags, **Keep** everything else on Power Apps until the tenant's app inventory and seat split are known (section 7).
- **The licence saving is not automatic.** Premium is per user with unlimited apps [S1], so a seat is only freed when *every* app that user needs has moved off Power Apps. Moving three apps saves nothing on licences if the same users still need other Power Apps.

---

## 2. Scope and what this does not cover

- Compares (a) staying on Power Apps Premium with (b) building the apps on the shared TypeScript/Postgres platform in this repo, with Devin writing the code and engineers reviewing it.
- **Not covered (no evidence in the allowed sources):** hosting/infrastructure cost of the custom platform; the client's Entra ID / Microsoft 365 licensing; engineer salary or day rates; Retool/LaunchDarkly/KYC-vendor pricing [S13]–[S15] (Q7 was "no pricing"); Microsoft regulatory attestations (research "Not found").

---

## 3. Cost

### 3.1 Power Apps licence: today and 2027

| Line | Value | Source / working |
|---|---|---|
| Current annual spend | $250,000 | Client-supplied (not sourced) |
| Premium list price | $20.00/user/month, paid yearly | [S1] [S20] |
| Implied seats at list | $250,000 ÷ ($20 × 12) = **≈1,042** | Research Q1 |
| Cost per app today (3 apps) | $250,000 ÷ 3 ≈ **$83,333/app/year** | Research Q8 |
| Extra licence cost of a 4th…10th app | **$0** for users already licensed ("no limit to the number of apps") | [S1] |
| Premium from 1 Jan 2027 (secondary, unverified) | $20 + $2 = **$22**/user/month; applies to terms starting on/after that date | [S28] |
| Same seats at $22 (**ASM-1**) | 1,041.67 × $22 × 12 = **$275,000/year** (+$25,000, +10%) | Arithmetic on [S1] [S28] |
| Same budget at $22 | $250,000 ÷ $264 ≈ **947 seats** | Research R2-Q3 |
| Cost per app at $22, same seats, 3 apps | $275,000 ÷ 3 ≈ **$91,667/app/year** | Arithmetic |

- **ASM-1:** the whole $250,000 is Premium seats at list price. Research Q1 notes it may also include Dataverse capacity ($40/GB/month [S1]), pay-as-you-go meters, Power Automate/Copilot Studio, or EA discounts; each lowers the implied seat count. **To verify:** the client's SKU mix.
- **Upward risk (inference from [S16]):** if users run apps in managed environments under Microsoft 365-included rights, February 2027 enforcement could require more Premium seats than are paid for today. **To verify:** licence assignments against active users.
- **Renewal date:** unknown. The $22 price only bites from the first term starting on/after 1 Jan 2027 [S28].
- The per-app SKU ($5/user/app/month [S20]) is no longer sold to new customers from 2 Jan 2026 [S17], so it isn't a cheaper fallback for new purchases.

### 3.2 Devin: plan plus measured usage

| Line | Value | Source / working |
|---|---|---|
| Teams full seat | $40/month → $40 × 12 = **$480/seat/year** | [S21] [S22] |
| ~60 engineers on full seats (**ASM-2**) | 60 × $480 = **$28,800/year** | R2-Q1 arithmetic |
| Teams cap | 200 users; larger teams go to Enterprise | [S22] |
| Enterprise ACU rate / minimums | **Not published** | [S23] |
| Usage past plan quota | Bought "at API pricing"; **rate not published** | [S21] [S22] |
| Typical cost per task | **Not published** ("varies") | [S21] |

**Measured Devin spend on this project (from the log):**

| Work | Measured cost | Source |
|---|---|---|
| Setup and scoping | $0 | Log rows 0–1 |
| Research round 1 (incl. follow-up) | $2.56 | Log rows 2–3 |
| A1 platform review + governance follow-ups | $16.32 − $10.61 = **$5.71** | Log rows 7–8 |
| Running total, all sessions to the blueprint fix | **$23.27** (covers rows 0–11 plus an unknown share of the A2 session running in parallel) | Log row 11 |
| **Refunds app (build + playbook)** | **Not recorded** ("See billing page") | Log rows 16–17 |
| A2 core, security review and fixes | **Not recorded** | Log rows 12–13, 15, 18 |

- **Gap (to fill before this goes to the client):** per-app usage `U_app` = billing running total after the refunds session − running total before it. Parallel sessions (A2 follow-ups, security review) ran the same day, so the split needs the billing page's per-session view or a note that it's a combined figure.
- **Time, measured where recorded:** A1 platform ~1 h (Log row 6); typical follow-ups 5–15 min (Log rows 7–9, 11, 14). The refunds session's start time wasn't recorded (Log row 16).

### 3.3 Engineer review time (stated assumption)

- **Not measured.** Every "Thomas review time" cell in the log is `_Thomas to fill_`.
- **ASM-3:** review time per app = `R_build` hours to review the build PRs + `R_maint` hours/year for follow-ups, at a loaded rate of `$H`/hour. **No values are in the sources**; the client should supply `$H`, and Thomas's own review times on refunds (Log rows 16–18) are the best first-party figure for `R_build` once logged.
- What the log does show about review effort: code-owned paths (`packages/core`, migrations, playbooks) always need a human to review and merge (Log rows 6, 12, 15–18); a core PR merged with an open security finding (Log row 13), which led to the rule that unresolved review threads block core merges. Human review is a fixed part of this model, not optional.

### 3.4 Side-by-side (formula, not a total)

```
Power Apps / year   = seats × $20 × 12   (→ $22 × 12 from the first term on/after 1 Jan 2027 [S28])
Build path / year   = Devin seats ($28,800 at ASM-2)
                    + Σ apps (U_build amortised + U_maint)      ← measured from DEVIN-LOG
                    + Σ apps (R_build + R_maint) × $H           ← ASM-3
                    + hosting / ops                              ← not researched
Licence avoided     = only seats whose users no longer need ANY Power App
```

- Devin seats alone: $28,800 ÷ $250,000 = **11.5%** of today's spend; $28,800 ÷ $275,000 = **10.5%** at $22 (ASM-1, ASM-2).
- Breakeven can't be stated until `U_app`, `R`, `$H`, hosting and the seat split are filled in. Leaving it blank is deliberate.

---

## 4. Maintenance burden

| | Power Apps (evidence) | Custom build with Devin (evidence) |
|---|---|---|
| Platform churn | Microsoft owns it, and it moves: Test Engine deprecated April 2026; Editable/Read-Only Grid deprecated March 2026; Cards deprecated Aug 2025 [S10]; per-app SKU end of sale [S17]; release plans replaced by "AI at Work" roadmap Sept 2026 [S19] | The team owns it: dependency pins (TypeScript 6 and ESLint 9 because plugins lag, Log row 6; month-old Radix/lucide releases chosen over days-old ones, Log row 10) |
| Source control / review | Canvas Git removed [S9]; solution-level Git integration from dev environments [S8]; diff quality not researched | Ordinary Git PRs, CI (`verify`, `e2e`), code-owner review on core (Log rows 6, 8–9) |
| Testing | Microsoft points users to Playwright after deprecating Test Engine [S10] | Named rule tests on real Postgres plus 1–2 Playwright tests per app; refunds had 34 rule tests, 30 of them shown failing first; the other 4 are DB-level backstops (Log row 16) |
| Correctness traps | Non-delegable queries process only 500 (max 2,000) rows and return wrong results silently [S2] | Traps hit and fixed, then written into the playbook: Drizzle ambiguous column, route announcer `role="alert"` (Log rows 16–17) |
| Environment upkeep | Managed by Microsoft (environments, DLP [S4] [S7]) | Real overhead: snapshot builds failed in three sessions (Log rows 10, 11, 18); Docker Hub rate limit (Log row 6); Playwright browsers missing (Log row 16) |
| Repeatability | Model-driven UI patterns staff know (list → form → timeline) [S24]–[S27] | Shared core + `new-internal-tool` playbook so the next apps follow refunds (Log row 17); the same UI patterns were rebuilt as components (Log row 6) |

Read: Power Apps' burden is **change imposed by the vendor**; the build path's burden is **ownership** (dependencies, environment, CI, review), which Devin carries much of but a human still has to review.

---

## 5. Security and compliance controls

| Control | Power Apps (evidence) | Custom build (evidence) |
|---|---|---|
| Identity | Entra ID [S4] | OIDC + PKCE against Keycloak as a local Entra stand-in; **the Entra swap is unproven** (Log row 6 risk list) |
| Maker-checker (no self-approval) | **Not published**; the Approvals connector's `Requestor` is optional free text, so it must be built into each flow and tested [S18] | Enforced in code **and** a DB constraint (Log row 12); refunds threshold split loophole found and fixed (Log row 18) |
| Field masking of PII | Column security can mask, but **system administrators bypass it** [S5] | Masked on the server, **no admin bypass**, reveal needs a reason and writes an audit row (Log rows 12, 16) |
| Audit trail | Field-level change history, retention up to 24,855 days [S3]; **no native export** (API only) [S3]; read logging to Purview **production only** [S3]; immutability **not researched** | Append-only audit in the same transaction as the change; `access.denied` rows (Log row 6); DB-trigger audit listed as hardening, not built (Log row 6) |
| Retention need (KYC) | 5 years after the relationship/account ends (US banks [S11]; UK MLR [S12]) — [S3]'s retention setting appears to cover this (inference) | Must be designed and evidenced by the team; not covered in the log |
| Independent testing | Microsoft attestations not researched | A dedicated adversarial review found 3 breaks (bulk unmasking, refund split under the £250 threshold, denials unaudited with prefetch headers), each with a failing test and a fix PR (Log row 18); earlier reviews caught logout CSRF and never-expiring sessions (Log row 7) and nested PII surviving masking (Log row 13) |

Read: the build path gives **stronger controls on the two KYC/refund risks that matter most** (self-approval, admin access to PII), but **every control is self-built**, so its assurance rests on the team's tests and reviews rather than a vendor attestation. The log shows that review process finding real issues, including one that slipped past a human merge (Log row 13).

---

## 6. Opportunity cost

- **Power Apps side:** 10+ more apps are planned (client input). On Premium those cost $0 more in licences for already-licensed users [S1], which is the strongest argument for **keeping** low-risk apps there. The cost is the platform limits above (delegation [S2], admin bypass [S5], self-approval [S18]) and vendor churn [S10].
- **Build side:** the scarce input is **engineer review time**, not Devin time. Every app touches `packages/core` to register permissions, so every app PR needs a code owner (Log rows 15–16). With ~60 engineers (client input), review is time taken away from product work; how much is ASM-3 and unmeasured.
- **Reuse:** the first app paid for the platform (A1, A2, governance: Log rows 6–15). Later apps reuse core plus the playbook (Log row 17), so their marginal cost should be lower than refunds'. **Inference, not yet measured:** KYC (#12) and flags (#13) are specced but unbuilt (Log row 14).

---

## 7. Recommendation per app (draft)

| App | Draft call | Why (evidence) | Conditions / open questions |
|---|---|---|---|
| **Refunds dashboard** | **Build** (done: reference app) | Maker-checker is the core control, and Power Automate doesn't enforce it natively [S18]; ours enforces it in code + DB; the adversarial review's one refunds break (splitting under the threshold) got a test and a fix PR (Log rows 12, 16, 18) | Prove the Entra swap; run in parallel with the Power App until ops sign off; record `U_app` and review time (sections 3.2–3.3); does it move money or only request it? (requirements.md) |
| **KYC review queue** | **Build** (next), **Keep** the Power App live until cut-over | Highest-sensitivity data; Dataverse column security doesn't apply to system administrators [S5]; audit export is API-only [S3]. Our masking has no admin bypass (Log row 12) | Not built yet (issue #12, Log row 14), so cost is unmeasured; retention design for 5 years [S11] [S12]; auditor sign-off before cut-over; ID verification itself may be a vendor buy (not researched, Q7) |
| **Feature-flag admin** | **Buy** (or self-host OSS) | Mature options exist: LaunchDarkly (commercial) [S13], Unleash (open source, self-hostable) [S14]; lowest regulatory exposure, mostly engineer users (requirements.md, HYPOTHESIS) | Pricing not researched; conflicts with issue #13, which specs a build; flags can gate KYC/money paths, so prod changes still need audit and approval |
| **Other apps on the tenant** | **Keep** | ≈1,042 implied seats vs 3 known apps: the seats probably cover more than these apps (research Q1, requirements open question); extra apps cost $0 more in licences [S1] | Inventory apps and users first; only seats used *solely* by migrated apps are savings |

---

## 8. Assumptions and open items

| ID | Assumption / gap | Who closes it |
|---|---|---|
| ASM-1 | $250,000 is all Premium seats at list, and seat count stays the same at renewal | Client (SKU mix, renewal date) |
| ASM-2 | ~60 engineers on Teams full seats (not Enterprise, not flex seats) | Client / Cognition sales (Enterprise rate not published [S23]) |
| ASM-3 | Review hours `R_build`, `R_maint` and rate `$H` | Thomas (log), client (`$H`) |
| Gap | Measured Devin cost per app (`U_app`) for refunds | Thomas, from the billing page |
| Gap | $22 price: secondary source only [S28] | Client's Power Platform admin (Message Center post ID) |
| Gap | Hosting/ops cost of the custom platform | Not researched |
| Gap | Which users use which apps (seat split) | Client |
| Gap | Vendor pricing for flags/KYC tools | Not researched |

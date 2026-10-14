# Per-app requirements

> **HYPOTHESIS — scoping input, not findings.**
> Everything in this file is an unvalidated assumption for scoping. None of it is sourced or verified with the client. User counts are left qualitative on purpose (no invented numbers). The research seat-count finding (≈1,042 implied seats, see research.md Q1) suggests most users are not engineers.

| App | Users (HYPOTHESIS) | Core operations (HYPOTHESIS) | Data sensitivity (HYPOTHESIS) | Auth / audit needs (HYPOTHESIS) | Compliance posture (HYPOTHESIS) | Est. complexity (HYPOTHESIS) |
|---|---|---|---|---|---|---|
| **KYC review queue** | Compliance / onboarding analysts, team leads; possibly external reviewers | List/claim cases, view customer identity docs, approve / reject / request more info, escalate, add notes | **Highest**: PII and identity documents, sanctions/PEP results | SSO; role- and team-scoped row access; column masking for PII; immutable audit of every decision with actor, timestamp and before/after; four-eyes on edge cases | **Heaviest compliance surface**: AML/KYC record retention (US BSA/CIP, UK MLR 2017; 5 years, see research.md Q4); regulator/auditor evidence; data-protection obligations | High |
| **Refunds dashboard** | Support / ops agents, finance approvers | Search transactions, start refund, approve/reject above thresholds, view refund status, reconcile | **High: financial data and money movement**; payment and customer data | SSO; maker/checker approval (requester ≠ approver); threshold-based approval routing; tamper-evident audit of who requested, approved or executed each refund; least-privilege access to payment rails | **Real compliance implications**: money movement controls, financial audit/SOX-style evidence (if applicable), payment-scheme and consumer-protection rules; fraud/abuse controls | Medium–High |
| **Feature-flag admin panel** | Engineers, product managers | Toggle flags per environment / segment, staged rollout, view change history, roll back | Medium: config, not customer data (but flags can gate money/KYC paths) | SSO; per-environment permissions (prod restricted); change audit log; optional approval for prod changes | Change-management evidence (who changed prod behaviour, when); lower regulatory exposure than the other two | Low–Medium (buy options exist, see research.md Q7) |

Open questions to validate with the client (HYPOTHESIS):
- Actual user counts and roles per app, and how the ≈1,042 implied seats split between these apps and other uses.
- Whether the refunds app executes money movement or only requests it from another system.
- Which regulator(s) and charter/licence apply (drives the US retention rule, see research.md Q4 note).
- Current audit-evidence process (what auditors ask for today).

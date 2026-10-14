# Power Apps build-vs-buy — research findings

Scope: research only (no stack choice, no prototype, no recommendation). Timeboxed to 40 min.
Rules applied: every number is quoted from a linked source; arithmetic is shown; anything unavailable is marked "not published" or "not researched in timebox". Client-supplied inputs (not sourced): $250K/year spend, ~60 engineers, 3 apps today, 10+ planned.

Sources are numbered [S1]–[S20] (cap raised from 15 to 20); full list at the bottom.

---

## Q1. Pricing & seats

- Power Apps Premium list price is **$20.00 per user/month, paid yearly**. [S1]
  > "Power Apps Premium | $20.00 | user/month, paid yearly"
- A lower Premium tier is **$12.00 per user/month with a 2,000-seat minimum**. [S1]
  > "Power Apps Premium (with 2,000-seat minimum) | $12.00 | user/month, paid yearly"
- A pay-as-you-go option also exists (usage billed via Azure); its per-unit price is **not published on the page reviewed**. [S1]
  > "Pay-as-you-go: Azure-based, pay only for usage - ideal for variable or seasonal app needs."
- Microsoft's licensing FAQ gives the same Premium prices and lists a per-app plan at **$5/user/app/month**. [S20]
  > "…for $20/user/month (or $12 per user/month with 2,000+ new user licenses)."
  > "…based on the full capabilities of Power Apps for $5/user/app/month."
- Dataverse database capacity add-on: **$40.00 per GB/month, paid yearly**. [S1]
- **$22/user/month: not found in any Microsoft source checked** (pricing page, licensing FAQ, licensing overview, Partner Center announcements Nov 2025–Oct 2026). The pricing page shows $20.00. Treat $22 as unverified and don't use it.
  > "Dataverse Database Capacity add-on | $40.00 | GB/month, paid yearly"

**Implied seat count (working):**
- $20.00 × 12 months = $240.00 per user/year
- $250,000 ÷ $240.00 = **≈1,042 seats** (1,041.67)
- Check against the $12 tier: 2,000 seats × $12.00 × 12 = $288,000/year minimum, which is above $250,000, so the $12 tier is not consistent with the stated spend at list price.

**Tier ambiguity:** if the client is on the per-app plan ($5/user/app/month) instead of Premium, the seat maths changes completely. Per-app is no longer sold to new customers (see Q6). The $250K may also include things other than Premium seats (Dataverse capacity add-ons, pay-as-you-go meters, Power Automate or Copilot Studio, negotiated EA discounts). Each of these would lower the implied seat count. The client's actual SKU mix is unknown.

**Framing:** ≈1,042 seats is far more than ~60 engineers, so **the seat count implies the user base is mostly non-engineers. Verify the audience mix (ops/compliance/support vs. engineering) and the actual SKU breakdown with the client.**

---

## Q2. Platform layer (what a bespoke build would have to replicate)

- **Connectors:** Premium includes prebuilt, custom and on-premises connectors. [S1]
  > "Use prebuilt, custom, and on-premises connectors"
- **Dataverse** (managed data store, with security model and business logic). [S1]
  > "Dataverse comes with enterprise-grade security, compliance, governance, role-based access control, rich data types, relationships, business logic capabilities"
- **Identity / RBAC via Entra ID:** [S4]
  > "Users are authenticated by Microsoft Entra ID."
  > "Ability to create applications and flows is controlled by security roles in the context of environments."
- **Environments as security boundaries:** [S4]
  > "Environments act as security boundaries allowing different security needs to be implemented in each environment."
- **ALM / promotion:** Microsoft's model is Git-backed solutions in dev environments, then pipelines to deploy. [S8]
  > "Use Git integration with developer environments, not in your test or production environments. Use builds to create solution artifacts and pipelines in Power Platform to deploy."
- **DLP (data policies):** admins can block connectors tenant-wide; makers then can't save apps that use them. [S7]
  > "Power Platform admin center data policies allow administrators to control access to these connectors in various ways to help reduce risk in your organization."
  > "If a data policy blocks the use of MSN Weather connector, a maker can't save their flow or app that uses this connector."

So a bespoke build needs its own equivalents of: SSO plus role mapping, a data store with row and column access control, environment separation, a deploy pipeline, and governance over which integrations each tool can call.

---

## Q3. Audit, approvals & data access controls (key question)

**Audit trail (Dataverse auditing):**
- Logs creates, updates and deletes; who changed what; previous values; and user access. [S3]
  > "Who created or updated a record and when? / Which fields in a record were updated? / What was the previous field value before the update?"
  > "Create, update, and delete operations on records." … "Changes to security roles." … "Deletion of audit logs."
- Update audits only fire when the value actually changes. [S3]
  > "Audit logs for updates are created when a new value is different from the old value of a column."
- Retention can be set: the default is forever, and a custom period can be up to 24,855 days. [S3]
  > "Default: Forever" … "Maximum: 24,855 days."
  - Working: 24,855 ÷ 365.25 ≈ 68.0 years, which is longer than the 5-year AML retention in Q4.
- Read/access logging goes to Purview **for production environments only**. [S3]
  > "User access or activity logging is sent to Purview for production environments only."
- **Evidence export gap:** there is no native export. Audit data has to be pulled through the API. [S3]
  > "Exporting audit logs isn't currently supported. Use the Web API or SDK for .NET to retrieve audit data from your environment."
- Audit logs use log storage capacity and can appear with a delay. [S3]
  > "Dataverse stores audit logs and they consume log storage capacity."

**Approvals (Power Automate):**
- Built-in approve/reject actions. One type requires every approver to respond. [S6]
  > "Approve/Reject - Everyone must approve" … "A response is needed from each approver before the flow run is completed."
- Approval flows and responses are stored in Dataverse, in an approvals history. [S6]
  > "When you create approval flows, they're saved in Dataverse."
  > "Users need this role for their responses to be processed and persisted in their approvals history."
- **Self-approval (maker/checker):** nothing in Microsoft's Approvals docs says requesters are stopped from approving their own request. **Not published.** On the evidence below, the connector does not enforce this: `Assigned To` is any list of email addresses, and `Requestor` is a separate, optional, free-text email field. Separation of duties would have to be built into the flow logic (e.g. a check that requester ≠ approver) or the app, and then tested. [S18]
  > "Assigned To | assignedTo | True | email | Email addresses, separated by a semicolon (;)"
  > "Requestor | requestor | email | Add the email of the person generating this request"
  - The connector's own "Known issues and limitations" list does not mention any self-approval restriction. The one identity safeguard it lists is about the sender: [S18]
    > "The creator of the flow will always be shown in the Approval details (email content and all clients). This is to prevent spoofing of approval sender identities."
- **Not researched in timebox:** whether approval history is immutable or tamper-evident, and its retention independent of Dataverse auditing. "Request more info" as a distinct audited action was also not researched.

**Row-level access:** [S4]
  > "Security in Dataverse can be implemented as a simple security model with broad access all the way to highly complex security models where users have specific record and field level access."

**Field-level (column) access, including masking:** [S5]
  > "You can use column level security to prevent certain users from: Setting the value of a column in a record. Viewing the data in a column. You can choose to mask this value"
- **Caveat that matters for KYC PII:** system administrators bypass it. [S5]
  > "Column-level security doesn't apply for users who have the system administrator role. Data is never hidden from system administrators."

**Audit evidence for regulated workflows (summary of the above):** Dataverse supports field-level change history with configurable retention, plus approval history in Dataverse. The open gaps are native export, admin bypass of column security, and access logging limited to production. Whether this satisfies the client's auditors is **not published** by Microsoft as a regulatory attestation in the sources reviewed.

---

## Q4. Compliance retention (KYC records)

- **US (BSA / CIP, banks):** identifying information must be kept for five years after the account is closed. [S11]
  > "…for five years after the date the account is closed or, in the case of credit card accounts, five years after the account is closed or becomes dormant."
  - Note: 31 CFR 1020.220 applies to banks. Which FinCEN part covers the client depends on its charter or licensing (e.g. a bank partner vs. an MSB), so verify with the client.
- **UK (MLR 2017 reg. 40):** keep records for five years after the business relationship ends, and not more than 10 years for some records. [S12]
  > "the period is five years beginning on the date on which the relevant person knows, or has reasonable grounds to believe—"
  > "A relevant person is not required to keep the records referred to in paragraph (3)(b)(i) for more than 10 years."

---

## Q5. Limitations (engineering lens)

- **Delegation / row limits:** queries that can't be delegated only process the first 500 records (up to 2,000), which can return wrong results silently. [S2]
  > "When a query is nondelegable, Power Apps gets the first 500 records from the data source and then runs the actions in the query. You can increase this limit to 2,000 records."
  > "…you only get the first 500 or 2,000 records. So, you get incorrect results."
- **Version control for canvas apps:** the old canvas-app Git feature has been removed. [S9]
  > "Git version control for editing apps has been removed and is no longer supported."
- **Current Git story = solution-level Dataverse Git integration** (Azure DevOps / GitHub), used from developer environments. [S8]
  > "Source control integration enables development teams to sync solutions and solution objects across one or more Microsoft Dataverse environments by using a supported Git provider, such as Azure DevOps or GitHub."
  - Not researched in timebox: how readable canvas-app source diffs are under this integration, and whether the feature is preview or GA.
- **Testability:** Microsoft deprecated Test Engine (its code-first test tool) and points users to Playwright. [S10]
  > "Effective April 2026, Test Engine is deprecated. The documentation and GitHub repository are no longer maintained by Microsoft"
  > "The Power Fx implementation created unnecessary limitations that are avoided if using Playwright directly"
  - Test Studio (the low-code test recorder) is not cited: dropped to stay within the source cap.

---

## Q6. Microsoft's commitment / direction (published only)

- **AI/agent direction in the product:** Premium now lists agentic features and Copilot chat. [S1]
  > "Use agentic features in apps" … "Use Microsoft 365 Copilot chat in apps"
- **Recent deprecations (from Microsoft's official "important changes" page):** [S10]
  > "Effective April 2026, Test Engine is deprecated."
  > "Effective March 2026, the Editable Grid control and the Power Apps Read-Only Grid control are deprecated in model-driven apps."
  > "Effective August 29, 2025, … will be deprecated and no longer supported." (Cards for Power Apps)
- **Licence enforcement in managed environments (February 2027):** unlicensed users will be blocked from opening apps. Notifications started in 2026. [S16]
  > "Starting February 2027, users who don't have an appropriate license are blocked from opening apps in the managed environment after receiving the final notification stage."
  > "Administrative notifications began in March 2026 through the Microsoft 365 Message center and Power Platform admin center."
  - What it applies to: [S16]
    > "Every user running an app in a managed environment must have one of the following licenses: a Power Apps Premium, a Power Automate Premium license, or a Dynamics 365 Enterprise license"
  - Implication (inference): if the client uses managed environments and has users running apps under Microsoft 365-included rights, the true seat need could exceed what they pay for today. Verify their licence assignment against active users.
- **Power Apps per app end of sale (effective January 2, 2026):** [S17]
  > "Effective January 2, 2026, the Power Apps per app SKU is no longer available for purchase by new customers."
  > "Existing Enterprise customers using this license will see no disruption and can continue to use and renew this SKU after their current agreement ends."
  - MPSA customers get a 60-day migration window when their agreement ends. CSP customers are not affected. [S17]
    > "After that, they will have a 60-day window to migrate to an alternative solution." … "Existing and new CSP customers will not be impacted."
- **Roadmap disclosure change (September 2026):** Microsoft is replacing its release plans with the "AI at Work" roadmap. [S19]
  > "Release Plans will no longer be published starting in September 2026. New Dynamics 365, Power Platform, and Dataverse capabilities will be published to the AI at Work roadmap beginning in September 2026."
- **Power Apps Premium price changes:** none found in the Microsoft sources checked. The current list price is $20.00 [S1], the same figure the licensing FAQ gives [S20]. Microsoft doesn't publish a price-change history, and no $22 figure was found.

---

## Q7. Alternatives (brief, no pricing)

- **Feature flags**
  - LaunchDarkly: commercial SaaS feature-flag platform. [S13]
    > "Runtime Control for AI-Era Software | Feature Flags & AI Agent Control | LaunchDarkly"
  - Unleash: open-source, self-hostable feature management. [S14]
    > "Open-source feature management platform"
- **Internal dashboards / admin tools**
  - Retool: commercial internal-tool builder. [S15]
    > "Build internal software better, with AI."
  - Appsmith / ToolJet (open-source builders): not cited, to stay within the source cap.
- **KYC:** dedicated KYC/identity-verification vendors exist. Not researched (out of scope).

---

## Q8. Cost model inputs (sourced numbers only)

| Input | Value | Source |
|---|---|---|
| Current annual spend | $250,000 | Client-supplied (not sourced) |
| Power Apps Premium list | $20.00/user/month, paid yearly | [S1] |
| Power Apps Premium (≥2,000 seats) | $12.00/user/month, paid yearly | [S1] |
| Dataverse DB capacity add-on | $40.00/GB/month, paid yearly | [S1] |
| Dataverse entitlement per Premium license | 250 MB database, 2 GB file | [S1] — "Dataverse entitlements of 250 MB database and 2 GB file" |
| Implied seats at list | ≈1,042 | Q1 working |
| Cost per app today (3 apps) | $250,000 ÷ 3 ≈ $83,333/app/year | Arithmetic on client figure |
| Power Apps per-user cost if apps grow to 10+ | No change: Premium is unlimited apps per user | [S1] — "There is no limit to the number of apps you can build using Power Apps." |
| Internal-tool build/maintenance cost norms | **No public benchmark found — assumption required.** | — |

---

## Sources (20)

| # | Source | Type |
|---|---|---|
| S1 | https://www.microsoft.com/en-us/power-platform/products/power-apps/pricing | Microsoft pricing |
| S2 | https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/delegation-overview | Microsoft Learn |
| S3 | https://learn.microsoft.com/en-us/power-platform/admin/manage-dataverse-auditing | Microsoft Learn |
| S4 | https://learn.microsoft.com/en-us/power-platform/admin/wp-security | Microsoft Learn |
| S5 | https://learn.microsoft.com/en-us/power-platform/admin/field-level-security | Microsoft Learn |
| S6 | https://learn.microsoft.com/en-us/power-automate/get-started-approvals | Microsoft Learn |
| S7 | https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention | Microsoft Learn |
| S8 | https://learn.microsoft.com/en-us/power-platform/alm/git-integration/overview | Microsoft Learn |
| S9 | https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/git-version-control | Microsoft Learn |
| S10 | https://learn.microsoft.com/en-us/power-platform/important-changes-coming | Microsoft Learn |
| S11 | https://www.law.cornell.edu/cfr/text/31/1020.220 | 31 CFR 1020.220 (Cornell LII copy; eCFR.gov blocked automated access) |
| S12 | https://www.legislation.gov.uk/uksi/2017/692/regulation/40 | UK legislation (official) |
| S13 | https://launchdarkly.com/ | Vendor |
| S14 | https://github.com/Unleash/unleash | Vendor (OSS repo) |
| S15 | https://retool.com/ | Vendor |
| S16 | https://learn.microsoft.com/en-us/power-platform/admin/managed-environment-licensing | Microsoft Learn |
| S17 | https://www.microsoft.com/licensing/news/power-app-per-app-end-of-sale | Microsoft licensing news |
| S18 | https://learn.microsoft.com/en-us/connectors/approvals/ | Microsoft Learn (connector reference) |
| S19 | https://learn.microsoft.com/en-us/dynamics365/release-plans/ | Microsoft Learn |
| S20 | https://learn.microsoft.com/en-us/power-platform/admin/powerapps-flow-licensing-faq | Microsoft Learn |

All pages were accessed on 2026-10-14. (Second pass, the same day: S16–S20 added after the cap was raised to 20.)

## Not found / not researched in timebox

- Pay-as-you-go per-unit price: not published on [S1].
- Client's actual SKU mix and any discounts: unknown (verify with client).
- Immutability and tamper-evidence of Dataverse audit logs and approval history: not researched.
- Microsoft regulatory attestations (e.g. SOC/ISO scope for Dataverse audit): not researched.
- Whether Dataverse Git integration is preview or GA, and canvas source diff quality: not researched.
- Self-approval prevention in Power Automate approvals: not published (S18 shows no built-in restriction).
- "$22/user/month": not found in Microsoft sources; unverified.
- Power Apps Premium price-change history: not published.
- Internal-tool maintenance cost benchmark: no public benchmark found — assumption required.
- US retention for non-bank fintechs (MSB rules, 31 CFR 1022): not researched.

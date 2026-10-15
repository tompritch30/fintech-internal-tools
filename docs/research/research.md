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
- **$22/user/month: not found in any Microsoft source checked** (pricing page, licensing FAQ, licensing overview, Partner Center announcements Nov 2025–Oct 2026). The pricing page shows $20.00. Treat $22 as unverified and don't use it. *(Round 2: a secondary source reports +$2 from 1 Jan 2027; see R2-Q3.)*
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

---
---

# Round 2 (2026-10-15)

Scope: four follow-up questions (R2-Q1 to R2-Q4), timeboxed to 30 min. Same rules as round 1: every claim has a linked source and a short verbatim quote; "not published" is a valid finding; no estimates. Research only: no code, architecture or stack decisions.

New sources are numbered [S21]–[S31] and listed at the end of this section. That is 11 new sources against a cap of "~10". The 11th is [S30] (blueprints), which R2-Q4 needs. It's internal guidance only and can be dropped without affecting R2-Q1 to R2-Q3. All pages were accessed on 2026-10-15.

---

## R2-Q1. Devin / Cognition pricing (published only)

**Self-serve plans (published list prices):** [S21] [S22]

| Plan | Published price | Members | Source quote |
|---|---|---|---|
| Free | $0 | 1 | [S21] "Free … $0" |
| Pro | $20/month | 1 | [S22] "**Pro** \| Individual users \| \$20/month \| 1" |
| Max | $200/month | 1 | [S22] "**Max** \| Power users who need more quota \| \$200/month \| 1" |
| Teams | $80/month minimum, plus $40/month per full seat | Up to 200 | [S21] "$80 /month for team plan + $40/mo per full dev seat" |
| Enterprise | **Not published** ("Let's talk") | — | [S21] "Enterprise … Let's talk" |

- **Teams seat types:** full seats cost $40/month each. Flex seats are free, but all of their usage is paid from shared on-demand credits. [S22]
  > "**\$40/month per seat**, billed as a fixed recurring line item."
  > "Flex seats: Draw entirely from the team's shared pool of on-demand credits"
- **The Teams $80 minimum overlaps with seat charges:** two or more full seats clear the minimum. [S22]
  > "*N* ≥ 2 | \$0 | *N* × \$40"
- **Teams has a 200-user cap.** Larger teams go to Enterprise. [S22]
  > "**Up to 200 members**: invite teammates until your organization reaches 200 users. Larger teams should contact sales about Enterprise."
- **Usage-based elements (self-serve):** each plan includes a quota. Usage past the quota comes from prepaid on-demand credits, which are bought "at API pricing". [S21] [S22]
  > "Each paid plan comes with a usage allowance that refreshes automatically on a daily and weekly basis." [S21]
  > "If you do go beyond your included usage on a paid plan, you can purchase extra usage which is consumed at API pricing." [S21]
  > "On-demand credits are prepaid usage credit that fund any work past your plan's included quota … Purchased credits never expire." [S22]
- **ACUs (Enterprise):** Enterprise is billed in Agent Compute Units (ACUs) at a rate set in each customer's order form. **The ACU rate is not published.** [S23]
  > "Devin Enterprise customers are billed in **Agent Compute Units (ACUs)** at the rate set in their order form. Contact sales for pricing."
  > "They are distinct from self-serve quota and on-demand credits, and are priced per the customer's Enterprise order form."
- **Legacy ACU plans:** for self-serve, on-demand credits replaced ACUs at the same dollar value. **The page doesn't give that dollar value.** [S22]
  > "On-demand credits are the same dollar value as the ACUs you're used to."
- **Cost controls (Enterprise):** admins can set ACU limits per organization and per user. [S23]
  > "Enterprise admins can set per-Organization ACU limits" … "When an organization reaches its limit, new work billed to it is blocked."
- **Cost per task:** varies by model, task size and complexity, and reasoning required. No per-task figure is published. [S21]
  > "Cost per message varies based on the model used, the task size and complexity, and the reasoning required."

**Arithmetic on published figures only (no usage estimate):**
- Teams full seat: $40 × 12 = **$480 per full seat per year**, before any on-demand credits.
- Teams minimum: $80 × 12 = **$960 per year**.
- Starting team of ~60 engineers (client-supplied headcount, not sourced), all on full seats: 60 × $480 = **$28,800 per year** in seat charges. Seat cost then scales by $480 per extra full seat, up to the 200-user Teams cap (200 × $480 = $96,000). Usage past quota is extra and its rate isn't published.
- **The strongest usage input is our own measured spend, not published rates.** `docs/DEVIN-LOG.md` records the actual Devin cost of each session on this project (for example, round-1 research cost $2.56, rows 2 + 3). Once the apps are built, the measured Devin cost per app is first-party data for the cost slide.
- For comparison, the client-supplied figure is $250,000/year for Power Apps (not sourced). **Devin usage spend can't be derived from published data.** It depends on usage past quota (rate not published) or an Enterprise ACU rate and volume (not published). Use the measured per-session costs in `docs/DEVIN-LOG.md` instead.

**Not published (Devin pricing):**
- Enterprise ACU price, and any minimum commitment.
- The dollar size of each plan's included quota, and the per-unit "API pricing" for extra usage (not on the pages reviewed).
- The dollar value of an ACU (S22 says only that on-demand credits equal it).
- How many ACUs or credits a typical task uses.

---

## R2-Q2. Power Apps model-driven UI patterns (review-queue workflow)

Goal: describe the UI structure ops staff already know (list → record → actions), using Microsoft's own component names. This section describes, it doesn't design. Screenshot links point to images on Microsoft Learn (each one checked and returns HTTP 200). The screenshots may show an older UI version than the client's tenant.

### 1. App shell and navigation (site map)
- An app is made of work areas and tables, and each table has a **list view** and a **form view**. [S24]
  > "Tables normally present two views: a list view, which is typically a table listing available rows; and a form view, which shows all available data and settings for a single row. Use the side navigator to move between tables in your current work area."
- Left navigator elements: app name (switch app), collapse/expand site map, **Recent**, **Pinned**, page navigation (one entry per table or dashboard). [S24]
  > "Recent : Expand this entry to view a list of rows you were recently using." … "Pinned : Expand this entry to view and open your favorite pinned rows."
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/nav-expanded2.png

### 2. List view (the "queue")
- Documented list-view elements: Go back, **Select rows** (checkbox column), **Open a row**, **Sort or filter** per column, **advanced filtering panel**, **Command bar**, **Search the view**, **Jump bar and paging**. [S24]
  > "Select rows : Select one or more rows by placing a check mark in this column. Depending on where you're working, you might be able to apply a single operation to all the selected rows at once by using buttons in the command bar."
  > "Command bar : Use the commands in the command bar to operate on rows in the list and do related actions. Some commands (such as Delete ) require that you first select one or more target rows…"
  > "Search the view : Enter text in the search column above the list to show only those rows in the current view that contain your text."
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/list-view1.png

### 3. Record form ("row view")
- Documented form elements: **Tabs**, a **Related** tab, **Command bar**, **Heading bar** (key columns such as the owner), and the column body with required, recommended and read-only markers. [S24]
  > "Tabs : Most row views are divided into tabs. … The current tab is shown underlined."
  > "Related : Nearly all types of rows show a Related tab after you've saved them at least once."
  > "Command bar : … you can typically use the command bar to save your changes, delete the row, refresh the page, email a link to the row, reassign the row owner, or export the row by using a Word template."
  > "Heading bar : Some row views display a few especially important columns in the heading bar, opposite the row name. These are typically columns that are fundamental to working with rows of the current type (such as a row name or row owner)."
  > "Columns marked with a red asterisk are required … Columns marked with a blue plus sign are especially important or recommended … Columns showing a lock icon are read only and can't be edited."
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/form-view1.png
- **Row set navigation:** users can step from row to row through the list without going back to it, which suits queue work. [S24]
  > "The row-focused navigation improves productivity by allowing users to jump from row to row in the list and easily navigate back without losing their working list."
- **App message bar:** informational, warning and error notifications. Selecting an error takes the user to the column that caused it. [S24]
  > "The app message bar shows three types of notifications: informational, warning, and error. When you select the error notification, it will take you to the column on the form where the error occurred."
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/notifications_1.png

### 4. Stage / status bar (business process flow)
- The documented "status ribbon"-style element is the **business process flow** bar at the top of the record. It shows stages; the user fills each stage's required data and then moves to the next stage. It can be docked to the right. [S26]
  > "Where available, business processes provide a step-by-step timeline for the stages of a process at the top of the relevant row. You open the menu for the active stage, enter each column of required and business-critical data, and then select the next stage when you're ready to work with it."
  > "You can also dock the process bar to the right side of the screen for easy reference as you work with a customer row."
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/business-process.png
- The term "status ribbon" doesn't appear in the pages reviewed. The closest documented elements are the business process flow bar [S26] and the heading bar [S24]. Ask the client which one ops staff mean.

### 5. Assignment / ownership
- Every row has an owner (the creator by default). **Assign** on the command bar opens a dialog with "Me" or "User or Team". Assign works from the list (multi-select) or from the form. [S25]
  > "When you create a row, you're the owner of the row. If you want another person in your organization to take ownership of the row, assign the row to that person. You can assign a row to a user or team."
  > "From a list of rows, select the row that you want to assign to someone else. You can select multiple rows." … "On the command bar, select Assign ."
  > "Select Me to assign the row to yourself and then select Assign . Remember only a system administrator can assign a row that belongs to someone else to themselves."
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/reassign-2.png
- **Share** is separate from Assign: the owner keeps ownership and grants others permissions on the row. [S25]
  > "If you want to keep ownership of the row but let someone else work on it with you, then use the Share option to share the row."

### 6. Timeline (notes / activity panel)
- **Timeline** is the form control for history on a record: notes, posts and activities in one stream, with its own command bar, filters, search and attachments. [S27]
  > "You can use the timeline to view information that is connected to a row in a table and occurs over time in a single stream. Some information that can be logged into the timeline includes notes and posts, in addition to displaying activities such as emails, appointments…"
  > "Access the command bar to perform common actions quickly" … "Filter and view important notes, posts, and activities using multiple filter options"
  - Screenshot: https://learn.microsoft.com/en-us/power-apps/user/media/timeline-browser-view.png
  - Ambiguity: the same page also says "The Notes feature isn't available from the timeline." That contradicts the quote above, and the page doesn't explain it.
- What the timeline shows depends on admin configuration, so it can differ between users. [S27]
  > "The timeline dashboard displays only the entities that are configured for the signed-in user. So, what you see on the timeline may differ from what another user sees."

**Workflow summary (from the sources above):** site map → list view (select, search, filter, command bar actions such as Assign) → form (heading bar with owner, tabs, business process flow stages, command bar: Save, Assign, etc.) → timeline for notes and history → row set navigation to the next item.

**Not established in timebox:** what the client's apps actually look like (customized forms and views may differ from the docs); whether they use business process flows at all; how the command bar is customized (the modern command designer page was not cited, to stay within the source cap).

---

## R2-Q3. "$22" Power Apps Premium price re-check

- **Secondary source found (not Microsoft):** 2Data, an independent licensing advisory, reports a $2/user/month increase to both Power Apps Premium plans from **1 January 2027**, for new purchases, renewals and co-terminations. [S28]
  > "Beginning January 1, 2027, the list prices for the two Power Apps Premium plans will be updated, with each plan increasing by two dollars per user per month, applying to new purchases, renewals, and co-terminations with subscription terms beginning on or after that date, while current pricing remains in effect for the remainder of any existing subscription term"
  > "From January 2027, both of these price points rise by two dollars per user per month. That is a ten percent increase on the standard twenty dollar rate…"
  > "…it affects only these two Power Apps Premium SKUs, other Power Apps and Power Platform products are not affected, and entitlements included with Microsoft 365 and Dynamics 365 subscriptions remain unchanged."
  - Arithmetic on S28's figures: $20 + $2 = **$22**, and $12 + $2 = **$14** (≥2,000-seat tier). S28 states the increase but never writes the figures "$22" or "$14".
  - S28 is dated "September 15, 2026" and reads as if paraphrasing a Microsoft notice. It doesn't link to or name one (no Message Center ID).
- **Microsoft primary source: not found publicly.**
  - Licensing FAQ [S20]: no 2027 price change found on re-check.
  - Partner Center announcements for July, August, September and October 2026 (re-checked): no Power Apps Premium price change found.
  - Pricing page [S1]: an automated re-fetch returned a stub page, so it could not be re-checked in this round.
  - The Microsoft 365 Message Center is only visible inside a tenant, so it can't be verified from here.
- **Status:** the $22 figure is a **secondary, unverified finding** (S28, consistent with what Thomas saw in Message Center). **$20.00 stays the sourced number** [S1] [S20].
- **Sensitivity only (not a sourced input):** at $22, $22 × 12 = $264 per user/year, and $250,000 ÷ $264 ≈ **947 seats** (946.97), versus ≈1,042 at $20.00 (round 1, Q1). Per S28, the new price applies only to subscription terms starting on or after 1 January 2027.
- **To verify:** ask the client's Power Platform admin for the Message Center post ID and text (or a screenshot), and their renewal date.

---

## R2-Q4. Devin best-practice docs — INTERNAL WORKING GUIDANCE (not client-facing)

> **Internal only.** This section helps structure our own Devin sessions on this project. It is **not** evidence for the build-vs-buy recommendation and shouldn't appear in client material.

- **AGENTS.md:** Devin reads an `AGENTS.md` before it starts coding. Only the first 16 KiB is injected automatically, so put critical rules at the top and move longer guidance into skills or referenced files. [S29]
  > "Just put an `AGENTS.md` file in your project root (or anywhere else). Devin will look for the file before it starts coding."
  > "Devin automatically includes up to 16 KiB (16,384 bytes) from the beginning of each `AGENTS.md` file in its context. … Keep critical instructions near the top, keep always-on guidance under 16 KiB, and move longer or situational guidance into skills or referenced files."
- **Blueprints:** a blueprint defines the environment. Its `knowledge` section is where lint, test and build commands go; architecture, conventions and team workflows belong in Skills. Blueprints can live in the repo as `.devin/blueprint.yaml`, so they get code review. [S30]
  > "**`knowledge`** is reference information, not executed. This is how you tell Devin the correct commands for linting, testing, and building. Keep entries lightweight and focused on executable commands."
  > "For architecture docs, conventions, and team workflows, use the standalone Skills feature instead."
  > "You can store blueprints as `.devin/blueprint.yaml` files directly in your repository."
  > "Once you approve the suggestions, a build runs and produces a snapshot. Start a new session to boot from it, then ask Devin to run your lint or test commands to confirm everything works."
- **Testing / CI:** after opening a PR, Devin can enter testing mode: set up the environment, write a short plan for the single most important end-to-end flow, and record a video once CI is green. Recordings are a sanity check; test suites and CI provide the real coverage. Repo skills under `.agents/skills/` are followed during testing. [S31]
  > "After CI is green and any review comments are addressed, Devin executes the test"
  > "Identifies the **single most important end-to-end flow** that proves the feature works"
  > "If you need more exhaustive coverage, use your existing test suites and CI rather than visual recording."
  > "**Checks for relevant skills** in the repo (under `.agents/skills/`) and follows them if found"
- **Session playbooks:** not cited, to stay within the source cap. Candidate page: https://docs.devin.ai/product-guides/using-playbooks. Related finding, uncited for the same reason: docs.devin.ai/onboard-devin/knowledge-onboarding marks the Knowledge feature as deprecated in favour of Skills.

---

## Round 2 sources (11)

| # | Source | Type | Used in |
|---|---|---|---|
| S21 | https://devin.ai/pricing | Cognition pricing page | R2-Q1 |
| S22 | https://docs.devin.ai/admin/billing/self-serve | Devin docs (billing) | R2-Q1 |
| S23 | https://docs.devin.ai/admin/billing/enterprise | Devin docs (billing) | R2-Q1 |
| S24 | https://learn.microsoft.com/en-us/power-apps/user/navigation | Microsoft Learn | R2-Q2 |
| S25 | https://learn.microsoft.com/en-us/power-apps/user/assign-or-share-records | Microsoft Learn | R2-Q2 |
| S26 | https://learn.microsoft.com/en-us/power-apps/user/work-with-business-processes | Microsoft Learn | R2-Q2 |
| S27 | https://learn.microsoft.com/en-us/power-apps/user/add-activities | Microsoft Learn (timeline) | R2-Q2 |
| S28 | https://2-data.com/knowledge-hub/power-apps-premium-is-getting-more-expensive-what-changes-on-1-january-2027/ | Secondary (licensing advisory) | R2-Q3 |
| S29 | https://docs.devin.ai/onboard-devin/agents-md | Devin docs (internal guidance) | R2-Q4 |
| S30 | https://docs.devin.ai/onboard-devin/environment/blueprints | Devin docs (internal guidance) | R2-Q4 |
| S31 | https://docs.devin.ai/work-with-devin/testing-and-recordings | Devin docs (internal guidance) | R2-Q4 |

Also checked for R2-Q3, with no relevant content found (not counted as sources): [S20] (re-check) and https://learn.microsoft.com/en-us/partner-center/announcements/2026-july, 2026-august, 2026-september and 2026-october.

## Round 2: not found / not researched in timebox

- Devin Enterprise ACU rate and minimums: not published.
- Dollar size of Devin plan quotas, and the per-unit "API pricing" for extra usage: not published on the pages reviewed.
- Typical Devin ACU or credit use per task: not published.
- Microsoft primary source for the $22 Premium price: not publicly found (Message Center is tenant-only); secondary source only [S28].
- Pricing page [S1] re-check: not possible in this round (automated fetch returned a stub).
- The client's actual model-driven app customizations (forms, views, business process flows): unknown, verify with the client.
- Modern command designer details and Devin playbooks docs: not cited, to stay within the source cap.

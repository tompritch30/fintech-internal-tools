import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "demo-only-change-me"; // local Keycloak demo users only

async function signIn(page: Page, username: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#kc-login").click();
  await expect(page.getByTestId("username")).toHaveText(username);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Claims the first open high-risk case with the given flag and approves it; returns the case page URL. */
async function claimAndApproveHighRisk(page: Page, flag: "PEP" | "Sanctions"): Promise<string> {
  await page.getByRole("link", { name: "KYC queue" }).click();
  await page.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/kyc\/status\/open$/);
  await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Opened" }).click(); // sorting keeps the status filter
  await expect(page).toHaveURL(/\/kyc\/status\/open\?sort=openedAt/);
  await page.getByRole("row").filter({ hasText: flag }).first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/kyc\/cases\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Claim case" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("In review");
  await page.getByRole("button", { name: "Approve (needs sign-off)" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Awaiting sign-off");
  return page.url();
}

test("analyst approves a high-risk case, a different approver opens the ID and signs it off", async ({ page }) => {
  await signIn(page, "analyst");
  const caseUrl = await claimAndApproveHighRisk(page, "PEP");
  await expect(page.getByText("Waiting for a different approver")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign off approval" })).toHaveCount(0);
  await expect(page.getByText("SYNTHETIC TEST DOCUMENT")).toHaveCount(0);
  await signOut(page);

  await signIn(page, "approver");
  await page.goto(caseUrl);
  const doc = page.getByRole("form", { name: "Open utility_bill.pdf" });
  await doc.getByLabel(/Reason for opening/).fill("Proof of address check");
  await doc.getByRole("button", { name: /^Open/ }).click();
  await expect(doc).toContainText("SYNTHETIC TEST DOCUMENT");
  await page.getByRole("button", { name: "Sign off approval" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Approved");
  const history = page.getByRole("list", { name: "History" });
  for (const action of ["kyc.claimed", "approval.requested", "field.unmask", "approval.approved", "kyc.approved"]) {
    await expect(history).toContainText(action);
  }
  await expect(page.getByRole("button", { name: "Sign off approval" })).toHaveCount(0);
});

test("an analyst-approver is blocked from signing off their own high-risk approval", async ({ page }) => {
  await signIn(page, "senior");
  // Sanctions cases, so the two tests never pick the same case when run in parallel.
  await claimAndApproveHighRisk(page, "Sanctions");
  await expect(page.getByText("You asked for this sign-off")).toBeVisible();
  await page.getByRole("button", { name: "Sign off approval" }).click();
  await expect(page.getByRole("form", { name: "Sign off approval" }).getByRole("alert")).toHaveText(
    "You asked for this sign-off, so a different approver must give it.",
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Awaiting sign-off");
  await expect(page.getByRole("list", { name: "History" })).not.toContainText("approval.approved");
});

import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "demo-only-change-me"; // local Keycloak demo users only
const OVER_THRESHOLD = "250.01"; // default REFUND_APPROVAL_THRESHOLD_PENCE is 25000

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

async function approve(page: Page, note?: string) {
  await page.getByRole("button", { name: "Approve refund" }).click();
  const dialog = page.getByRole("dialog");
  if (note) await dialog.getByLabel("Approval note (optional)").fill(note);
  await dialog.getByRole("button", { name: "Approve refund" }).click();
}

/** Requests a refund over the threshold on the payment with the most left to refund; returns the refund page URL. */
async function requestLargeRefund(page: Page, reason: string): Promise<string> {
  await page.getByRole("link", { name: "Refunds", exact: true }).click();
  await page.getByRole("link", { name: "Refundable" }).click(); // sort ascending
  await page.getByRole("link", { name: "Refundable" }).click(); // then descending
  await page.getByRole("row").nth(1).getByRole("link").first().click();
  await page.getByRole("button", { name: "Request refund" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount (£)").fill(OVER_THRESHOLD);
  await dialog.getByLabel("Reason", { exact: true }).fill(reason);
  await dialog.getByRole("button", { name: "Request refund" }).click();
  await expect(page).toHaveURL(/\/refunds\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pending approval");
  return page.url();
}

test("analyst requests a large refund, approver approves it from the queue, and the money moves once", async ({ page }) => {
  const reason = `Item returned unopened (e2e ${Date.now()})`;
  await signIn(page, "analyst");
  await requestLargeRefund(page, reason);
  await expect(page.getByRole("status", { name: "Refund actions" })).toHaveText("You requested this refund. Waiting for a different approver.");
  await expect(page.getByRole("button", { name: "Approve refund" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "approver");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Approvals", exact: true }).click();
  await page.getByRole("row").filter({ hasText: reason }).getByRole("link", { name: "Review" }).click();
  await approve(page, "Return confirmed by warehouse");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refunded");
  const history = page.getByRole("list", { name: "History" });
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await expect(history).toContainText("refund.succeeded");
  await expect(history).toContainText("approval.approved");
  await expect(page.getByRole("button", { name: "Approve refund" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: reason })).toHaveCount(0);
});

test("requester with approver rights is not offered approval of their own refund; a different approver approves it", async ({ page }) => {
  const reason = `Charged twice (e2e ${Date.now()})`;
  await signIn(page, "senior");
  const refundUrl = await requestLargeRefund(page, reason);
  await expect(page.getByRole("status", { name: "Refund actions" })).toHaveText("You requested this refund. Waiting for a different approver.");
  await expect(page.getByRole("button", { name: "Approve refund" })).toHaveCount(0);
  await signOut(page);

  // Positive control: a different approver can approve the same refund.
  await signIn(page, "approver");
  await page.goto(refundUrl);
  await approve(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refunded");
});

test("revealing a customer name asks for a real reason, then shows the name in place of the masked one", async ({ page }) => {
  await signIn(page, "approver");
  await page.getByRole("link", { name: "Refunds", exact: true }).click();
  await page.getByRole("row").nth(1).getByRole("link").first().click();
  const masked = page.locator("[data-masked]").first();
  await expect(masked).toBeVisible();
  await page.getByRole("button", { name: "Reveal customer name" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("          ");
  await dialog.getByRole("button", { name: "Reveal" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give a reason for revealing this.");
  await dialog.getByLabel("Reason").fill("Customer called about a refund");
  await dialog.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByTestId("revealed-customer-name")).toBeVisible();
  await expect(masked).toBeHidden();
});

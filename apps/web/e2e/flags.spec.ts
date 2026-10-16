import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "demo-only-change-me"; // local Keycloak demo users only
const FLAG = "e2e-sandbox-flag"; // added off everywhere by e2e/global-setup.ts; the first test leaves prod off again

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

async function openFlag(page: Page) {
  await page.getByRole("link", { name: "Feature flags", exact: true }).click();
  await page.getByRole("link", { name: FLAG, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(FLAG);
}

test("turning a flag on in prod waits for a different approver, and the kill switch turns it off at once", async ({ page }) => {
  const reason = `Launch to 20% (e2e ${Date.now()})`;
  await signIn(page, "analyst");
  await openFlag(page);
  const prodForm = page.getByRole("form", { name: "Request a prod change" });
  await prodForm.getByLabel("prod state").selectOption("on");
  await prodForm.getByLabel("Rollout %").fill("20");
  await prodForm.getByLabel("Reason").fill(reason);
  await prodForm.getByRole("button", { name: "Request prod change" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Prod off");
  await expect(page.getByText("You requested this prod change. Waiting for a different approver.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve prod change" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "approver");
  await page.getByRole("link", { name: "Flag approvals" }).click();
  await page.getByRole("row").filter({ hasText: reason }).getByRole("link", { name: "Review" }).click();
  await page.getByRole("button", { name: "Approve prod change" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Prod on · 20%");
  const history = page.getByRole("list", { name: "History" });
  await expect(history).toContainText("prod: Off · 0% → On · 20%");
  await expect(history).toContainText("approval.approved");
  await signOut(page);

  await signIn(page, "analyst");
  await openFlag(page);
  const kill = page.getByRole("form", { name: "Prod kill switch" });
  await kill.getByLabel("Why turn it off?").fill("Error rate up after launch");
  await kill.getByRole("button", { name: "Turn off in prod now" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Prod off");
  await expect(history.getByRole("listitem").first()).toContainText("flag.killed");
  await expect(history.getByRole("listitem").first()).toContainText("prod: On · 20% → Off · 20%");
});

test("an engineer changes dev directly and the history shows before and after", async ({ page }) => {
  await signIn(page, "analyst");
  await openFlag(page);
  const devForm = page.getByRole("form", { name: "Change dev" });
  const before = await devForm.getByLabel("Rollout %").inputValue();
  const next = String((Number(before) % 99) + 1); // always different from before, 1..99
  await devForm.getByLabel("dev state").selectOption("on");
  await devForm.getByLabel("Rollout %").fill(next);
  await devForm.getByLabel("Reason").fill("Testing the new banner");
  await devForm.getByRole("button", { name: "Save dev" }).click();
  await expect(devForm.getByRole("status")).toContainText("Saved");
  const latest = page.getByRole("list", { name: "History" }).getByRole("listitem").first();
  await expect(latest).toContainText("flag.value_changed");
  await expect(latest).toContainText(`→ On · ${next}%`);
});

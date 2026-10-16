import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "demo-only-change-me"; // local Keycloak demo users only

async function signIn(page: Page, username: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#kc-login").click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
}

test("analyst signs in through Keycloak, sees their roles in the account menu, and signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, "analyst");
  await expect(page.getByTestId("username")).toHaveText("analyst");
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);

  await page.getByRole("button", { name: /account menu/i }).click();
  await expect(page.getByRole("list", { name: "Your roles" })).toHaveText("analyst");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("analyst is denied the audit log, and admin sees that denial in it", async ({ page }) => {
  await signIn(page, "analyst");
  await expect(page.getByTestId("username")).toHaveText("analyst");
  await page.goto("/audit");
  await expect(page).toHaveURL(/\/no-access$/);
  await signOut(page);
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, "admin");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" }).click();
  const filters = page.getByRole("form", { name: "Audit filters" });
  await filters.getByLabel("Action", { exact: true }).selectOption("access.denied");
  await filters.getByLabel("Record ID").fill("/audit");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/action=access.denied/);
  const row = page.getByRole("row").filter({ hasText: "access.denied" }).filter({ hasText: "/audit" }).first();
  await expect(row).toContainText("Avery Analyst");
  await expect(row.getByTitle("analyst", { exact: true })).toBeVisible();
});

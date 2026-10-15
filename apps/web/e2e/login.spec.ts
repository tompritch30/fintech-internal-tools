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

test("analyst signs in through Keycloak, sees their roles, and signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, "analyst");
  await expect(page.getByTestId("username")).toHaveText("analyst");
  await expect(page.getByText("analyst", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);

  await signOut(page);
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
  await page.getByRole("link", { name: "Audit log" }).click();
  await page.getByRole("searchbox").fill("access.denied");
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("row").filter({ hasText: "access.denied" }).filter({ hasText: "/audit" }).first();
  await expect(row).toContainText("analyst");
});

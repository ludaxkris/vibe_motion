import { expect, test } from "@playwright/test";

test("home page offers a URL input", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Add motion to a page" }),
  ).toBeVisible();
  await expect(page.getByLabel("Page URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clone page" })).toBeEnabled();
});

test("submitting a URL clones the page and opens the editor", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone page" }).click();

  await page.waitForURL(/\/p\/.+/);
  await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
});

test("help page lists catalog entries", async ({ page }) => {
  await page.goto("/help");

  await expect(
    page.getByRole("heading", { name: "Animation catalog" }),
  ).toBeVisible();

  const cards = page.getByTestId("catalog-card");
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});

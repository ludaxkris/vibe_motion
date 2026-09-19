import { expect, test, type Page } from "@playwright/test";

/**
 * The clone → editor flow against the MSW mock api (`apps/web/mocks/`), which
 * is what `pnpm e2e` runs and the only place a clone is instant and its result
 * fixed. The same flow against the real api and a real page is
 * `../stack/editor.spec.ts`.
 */

async function cloneExampleCom(page: Page) {
  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/.+/);
}

test("submitting a URL clones the page and opens the editor", async ({ page }) => {
  await page.goto("/");
  await cloneExampleCom(page);

  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toBeVisible();

  const iframe = preview.getByTitle("Cloned page preview");
  await expect(
    iframe.contentFrame().getByRole("heading", { name: "Welcome to the fixture page" }),
  ).toBeVisible();

  await expect(page.getByRole("complementary", { name: "Control Panel" })).toBeVisible();
});

test("the Control Panel separator resizes with the keyboard", async ({ page }) => {
  await page.goto("/");
  await cloneExampleCom(page);

  // The separator describes the primary (preview) pane, per APG's
  // window-splitter pattern: a 25% Control Panel is a 75% preview.
  const separator = page.getByRole("separator", { name: "Resize Control Panel" });
  await expect(separator).toHaveAttribute("aria-valuenow", "75");

  // Clicking is enough to focus it: the drag must not preventDefault() the
  // focus a click gives every other focusable control.
  await separator.click();
  await expect(separator).toBeFocused();

  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "80");

  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "70");

  // …and the panel really is at its widest, whatever the separator announces.
  const panel = page.getByRole("complementary", { name: "Control Panel" });
  const [panelBox, viewport] = [await panel.boundingBox(), page.viewportSize()];
  expect(panelBox && viewport && Math.round((panelBox.width / viewport.width) * 100)).toBe(30);
});

test("a cloned project comes back under Recent projects", async ({ page }) => {
  await page.goto("/");

  // Nothing cloned in this browser yet, so the whole column is absent.
  await expect(page.getByRole("region", { name: "Recent projects" })).toHaveCount(0);

  await cloneExampleCom(page);

  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent projects" });
  await expect(recent).toBeVisible();
  await expect(recent.getByRole("link", { name: "Open example.com" })).toBeVisible();
});

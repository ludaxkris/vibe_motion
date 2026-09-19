import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// `/help` is driven by the catalog, so the expectation is too. Read from the
// package's own files rather than importing it: Playwright loads specs as
// CommonJS, and `animation-catalog` publishes an ESM-only entry point.
const CATALOG_DIR = path.resolve(__dirname, "../../../packages/animation-catalog");
const CURRENT_VERSION = readFileSync(path.join(CATALOG_DIR, "current"), "utf8").trim();
const CATALOG_SIZE: number = JSON.parse(
  readFileSync(path.join(CATALOG_DIR, "versions", `${CURRENT_VERSION}.json`), "utf8"),
).entries.length;

test("home page offers a URL input", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("Animate any page.");
  await expect(heading).toContainText("Paste a URL to clone it.");
  await expect(page.getByLabel("Page URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clone" })).toBeEnabled();
  // The scheme is the field's prefix, so a pasted URL loses it.
  await page.getByLabel("Page URL").fill("https://example.com");
  await expect(page.getByLabel("Page URL")).toHaveValue("example.com");
});

test("submitting a URL clones the page and opens the editor", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone" }).click();

  await page.waitForURL(/\/p\/.+/);
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

  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/.+/);

  const separator = page.getByRole("separator", { name: "Resize Control Panel" });
  await expect(separator).toHaveAttribute("aria-valuenow", "25");

  await separator.focus();
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "20");

  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "30");
});

test("a cloned project comes back under Recent projects", async ({ page }) => {
  await page.goto("/");

  // Nothing cloned in this browser yet, so the whole column is absent.
  await expect(page.getByRole("region", { name: "Recent projects" })).toHaveCount(0);

  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/.+/);

  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent projects" });
  await expect(recent).toBeVisible();
  await expect(recent.getByRole("link", { name: "Open example.com" })).toBeVisible();
});

test("help page plays the whole catalog", async ({ page }) => {
  await page.goto("/help");

  await expect(page.getByText(`catalog ${CURRENT_VERSION}`)).toBeVisible();

  const cards = page.getByTestId("catalog-card");
  await expect(cards).toHaveCount(CATALOG_SIZE);
  await expect(cards.first()).toBeVisible();

  // The keyframes come from the server as one stylesheet, and the first card's
  // block really is running them — this page is the catalog's visual test.
  await expect(page.locator("#vm-runtime")).toBeAttached();
  await expect(page.getByTestId("catalog-card-demo").first()).toHaveCSS(
    "animation-name",
    /^vm-/,
  );

  // The note is in the HTML for everyone; only the media query shows it.
  await expect(page.getByText("Your system asks for reduced motion")).toBeHidden();

  // `shimmer` slides a gradient across the block, and that gradient comes from
  // the catalog entry's `baseStyles` — drop those and the demo is a still
  // rectangle. Last, because it filters the grid down.
  await page.getByRole("searchbox", { name: "Search animations" }).fill("shimmer");
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId("catalog-card-demo").first()).not.toHaveCSS(
    "background-image",
    "none",
  );
});

test.describe("when the reader asks for less motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("help page holds every demo still until it is asked", async ({ page }) => {
    await page.goto("/help");

    // Suppressed by the page's own stylesheet, so this holds from the first
    // paint — before any JavaScript could have read the preference.
    await expect(page.getByTestId("catalog-card-demo").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(page.getByText("Your system asks for reduced motion")).toBeVisible();

    // Spin runs 2s and is capped to one pass here, so this is not racing the
    // animation's own end.
    await page.getByRole("searchbox", { name: "Search animations" }).fill("spin");
    await page.getByRole("button", { name: "Replay Spin" }).click();

    const demo = page.getByTestId("catalog-card-demo").first();
    await expect(demo).toHaveCSS("animation-name", /^vm-/);
    await expect(demo).toHaveCSS("animation-iteration-count", "1");
  });
});

test("the /dev gallery renders every state at the handoff's widths", async ({ page }) => {
  await page.goto("/dev");

  // jsdom has no layout, so this is the only place the handoff's widths are
  // actually measured: panel 320, unsaved guard 380, Save dialog 420.
  const widths: [string, string, number][] = [
    ["dev-frame-panel-tuning-distance", "[data-dev-frame-body]", 320],
    ["dev-frame-dialog-unsaved-guard", "[data-slot='dialog-card']", 380],
    ["dev-frame-dialog-save", "[data-slot='dialog-card']", 420],
  ];
  for (const [frame, selector, width] of widths) {
    const box = await page.getByTestId(frame).locator(selector).boundingBox();
    expect(box?.width, `${frame} is ${width}px wide`).toBe(width);
  }

  // Every frame the screenshot runner will ask for is on the page.
  for (const frame of [
    "dev-frame-panel-idle-empty",
    "dev-frame-panel-idle-assignments",
    "dev-frame-panel-selected",
    "dev-frame-panel-choosing",
    "dev-frame-panel-choosing-empty-search",
    "dev-frame-panel-tuning-scale",
    "dev-frame-toast",
    "dev-frame-entry-cloning",
    "dev-frame-entry-error",
  ]) {
    await expect(page.getByTestId(frame)).toBeVisible();
  }

  await page.getByRole("button", { name: "Show a toast for real" }).click();
  await expect(page.locator("[data-slot='toaster']")).toHaveText("Saved v6");
  // ~2s auto-dismiss, and nothing left behind.
  await expect(page.locator("[data-slot='toaster']")).toBeEmpty({ timeout: 5000 });
});

test("/dev/panel sends the old gallery to /dev", async ({ page }) => {
  await page.goto("/dev/panel");

  await page.waitForURL("**/dev");
  await expect(page.getByTestId("dev-frame-panel-idle-empty")).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});

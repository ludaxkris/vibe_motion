import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Specs that hold for *any* web deployment: they call no API and are as true of
 * the production build in the Docker stack as of `next dev` with the MSW mocks.
 * Anything that needs the mock api or a development build lives in `mocked/`;
 * anything that needs the real api lives in `stack/`.
 */

// `/help` is driven by the catalog, so the expectation is too. Read from the
// package's own files rather than importing it: Playwright loads specs as
// CommonJS, and `animation-catalog` publishes an ESM-only entry point.
// (The runner image copies these two paths in for exactly this reason.)
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
    // paint — before any JavaScript could have read the preference. Only the
    // Docker stack's production build really proves that (DT-118): under API
    // mocking `MockProvider` renders nothing until its worker is up.
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

  test("a held demo shows none of the paint its keyframes were going to move", async ({
    page,
  }) => {
    await page.goto("/help");

    // `underline-sweep`'s baseStyles paint a full-bleed gradient and leave the
    // `background-size` that turns it into a 2px underline to its keyframes.
    // Held still, that gradient would flood the whole block in currentColor.
    await page.getByRole("searchbox", { name: "Search animations" }).fill("underline");
    await expect(page.getByTestId("catalog-card")).toHaveCount(1);

    const demo = page.getByTestId("catalog-card-demo").first();
    await expect(demo).toHaveCSS("animation-name", "none");
    await expect(demo).toHaveCSS("background-image", "none");

    // Asking for it brings the whole animation back, gradient included.
    await page.getByRole("button", { name: "Replay Underline Sweep" }).click();

    // The run is only 500ms, and its `animationend` takes `data-vm-replayed`
    // off again — which would put the block straight back under the rule. Pause
    // the run so the assertions below are not racing it. (A replay mounts a
    // fresh block, so this locator resolves to the new one.)
    const running = page.getByTestId("catalog-card-demo").first();
    await running.evaluate((element) => {
      const pause = () => element.getAnimations().forEach((animation) => animation.pause());
      pause();
      // A freshly started CSS animation is still pending until the next frame.
      requestAnimationFrame(pause);
    });

    await expect(running).toHaveCSS("animation-name", /^vm-/);
    await expect(running).not.toHaveCSS("background-image", "none");
  });
});

test("health endpoint reports ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});

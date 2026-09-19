import { expect, test } from "@playwright/test";

/**
 * `/dev` is the gallery of every editor and entry state at its real width, for
 * reading against the Claude Design mocks and for the screenshot runner. It
 * `notFound()`s in a production build on purpose (`apps/web/app/dev/page.tsx`),
 * so it exists only for `pnpm e2e` — never inside the Docker stack, which runs
 * `next build` + `next start`.
 */

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
    "dev-frame-panel-tuning-selects",
    "dev-frame-dialog-unsaved-guard-many",
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

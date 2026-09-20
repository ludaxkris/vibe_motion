import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

/**
 * `/dev/export` stages every Export tab state at its real width
 * (`apps/web/app/dev/export/page.tsx`). It `notFound()`s in a production build
 * on purpose, so it exists only for `pnpm e2e` — never inside the Docker
 * stack, which runs `next build` + `next start`.
 *
 * What is measured here is what jsdom structurally cannot see: the 320px
 * panel width, a real clipboard, and a real download.
 */

const WITH_JS = "dev-frame-export-full-js";

/**
 * Landmarks from the stylesheet `/dev/export` stages
 * (`apps/web/app/dev/export/export-frames.tsx`). Compared against the
 * clipboard directly rather than against `innerText()` of the `<pre>`, which
 * normalises whitespace and trailing newlines and would drift for reasons that
 * have nothing to do with copying.
 */
const CSS_LANDMARKS = [
  "/* Vibe Motion · format 1 · v5 · saved 2026-09-20 (UTC) · catalog 1.1.0 */",
  "@keyframes vm-fade-in-up-v1-1-0",
  "@media (prefers-reduced-motion: no-preference)",
  ":where(.vm-js) .vm-in-view:not(.vm-play)",
];

test.describe("/dev/export", () => {
  test("stages every state in a 320px panel", async ({ page }) => {
    await page.goto("/dev/export");

    for (const frame of [
      WITH_JS,
      "dev-frame-export-full-no-js",
      "dev-frame-export-snippet",
      "dev-frame-export-pending",
      "dev-frame-export-error",
    ]) {
      const body = page.getByTestId(frame).locator("[data-dev-frame-body]");
      await expect(body).toBeVisible();
      const box = await body.boundingBox();
      expect(box?.width, `${frame} is 320px wide`).toBe(320);
    }
  });

  test("copies the open file to the clipboard and says so", async ({ context, page }) => {
    // Chromium refuses `navigator.clipboard` without these.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/dev/export");

    const frame = page.getByTestId(WITH_JS);
    await frame.getByRole("button", { name: "Copy vibe-motion.css" }).click();

    await expect(page.locator("[data-slot='toaster']")).toHaveText("Copied CSS");

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // The real stylesheet, not a placeholder, and whole.
    for (const landmark of CSS_LANDMARKS) {
      expect(clipboard).toContain(landmark);
    }
    expect(clipboard.endsWith("\n")).toBe(true);
  });

  test("downloads a zip of the bundle plus a README", async ({ page }) => {
    await page.goto("/dev/export");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId(WITH_JS).getByRole("button", { name: "Download .zip" }).click(),
    ]);

    // The encoder is loaded and run off the main thread, so the button says so
    // and comes back on its own.
    await expect(
      page.getByTestId(WITH_JS).getByRole("button", { name: "Download .zip" }),
    ).toBeEnabled();

    expect(download.suggestedFilename()).toBe("vibe-motion-nimbus-app-v5.zip");

    const path = await download.path();
    const unzipped = unzipSync(new Uint8Array(await readFile(path)));

    expect(Object.keys(unzipped)).toEqual([
      "index.html",
      "vibe-motion.css",
      "vibe-motion.js",
      "README.txt",
    ]);
    expect(strFromU8(unzipped["index.html"])).toContain('<link rel="stylesheet" href="vibe-motion.css">');
    expect(strFromU8(unzipped["vibe-motion.css"])).toContain("@keyframes vm-fade-in-up-v1-1-0");
    expect(strFromU8(unzipped["vibe-motion.js"])).toContain("vm-js");
    expect(strFromU8(unzipped["README.txt"])).toContain("vibe-motion.js");
  });

  test("will not open the file this export does not need", async ({ page }) => {
    await page.goto("/dev/export");

    const frame = page.getByTestId("dev-frame-export-full-no-js");
    const unused = frame.getByRole("tab", { name: "vibe-motion.js" });

    await expect(unused).toHaveAttribute("aria-disabled", "true");
    await expect(frame.getByRole("tab", { name: "vibe-motion.css" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

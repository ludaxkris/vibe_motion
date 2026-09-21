import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { cloneFixture, preview } from "./helpers";

/**
 * The Export tab against the real exporter: a real clone, animated through the
 * editor, saved as a real version, and exported from the panel a designer
 * actually clicks (Phase 7 Track C).
 *
 * `export.spec.ts` proves the exported *page* behaves — it serves the three
 * files on a foreign origin with no Vibe Motion anywhere near them. This one
 * proves the app in between: that what the tab shows and what the zip contains
 * are the bytes the API built for the version that was saved.
 *
 * The mocked twin (`../mocked/export.spec.ts`) covers the wiring — the guard,
 * "Export vN", Snippet — and deliberately asserts nothing about the CSS, whose
 * shape only the real exporter has (DT-033).
 */

function panel(page: Page) {
  return page.getByTestId("panel-export");
}

/** Click an element in the preview and give it Fade In Up, landing on tuning. */
async function applyFadeInUp(page: Page, element: Locator): Promise<void> {
  await element.click();
  await page.getByRole("button", { name: "Choose custom animation" }).click();
  await page.getByRole("button", { name: "Fade In Up", exact: true }).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
}

/** Top bar Save → "Save as v<seq>" → confirm → toast. */
async function saveVersion(page: Page, seq: number): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("save-dialog")).toContainText(`Save as v${seq}`);
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator('[data-slot="toaster"]')).toContainText(`Saved v${seq}`);
}

test("the Export tab shows, and downloads, what the exporter built for the saved version", async ({
  page,
}) => {
  // A real clone, a save and an export of a whole page: comfortably over the
  // 30s default under a parallel Docker run.
  test.setTimeout(90_000);

  await cloneFixture(page);
  const headline = preview(page).locator("#headline");
  await applyFadeInUp(page, headline);
  // A real clone numbers its own elements, so the class in the stylesheet is
  // derived here rather than hardcoded: `vm-17` → `.vm-a17`.
  const vmId = await headline.getAttribute("data-vm-id");
  expect(vmId).toMatch(/^vm-\d+$/);
  const elementClass = `.vm-a${(vmId ?? "").replace("vm-", "")}`;

  await saveVersion(page, 1);
  await page.getByRole("tab", { name: "Export" }).click();

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("v1", { exact: true })).toBeVisible();
  await expect(panel(page).getByText("· current")).toBeVisible();
  await expect(panel(page).getByTestId("export-stats")).toContainText("1 animation · 1 element");

  // The stylesheet on screen is the exporter's: this element's class, the
  // keyframes named for the catalog version the assignment pinned, and every
  // rule inside the reduced-motion query.
  const stylesheet = page.getByRole("region", { name: "vibe-motion.css" });
  await expect(stylesheet).toContainText(elementClass);
  await expect(stylesheet).toContainText(/@keyframes vm-fade-in-up-v\d+-\d+-\d+/);
  await expect(stylesheet).toContainText("@media (prefers-reduced-motion: no-preference)");
  // No in-view trigger in this version, so there is no script to download and
  // the footer says so rather than shipping a file nobody needs.
  await expect(panel(page).getByTestId("export-stats")).toContainText("js not needed");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel(page).getByRole("button", { name: "Download .zip" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^vibe-motion-.*-v1\.zip$/);
  const path = await download.path();
  const unzipped = unzipSync(new Uint8Array(await readFile(path)));

  expect(Object.keys(unzipped)).toEqual(["index.html", "vibe-motion.css", "README.txt"]);
  const html = strFromU8(unzipped["index.html"]);
  expect(html).toContain('<link rel="stylesheet" href="vibe-motion.css">');
  // The page a designer uploads carries the class, and none of our plumbing.
  expect(html).toContain(`vm-a${(vmId ?? "").replace("vm-", "")}`);
  expect(html).not.toContain("data-vm-id");
  expect(html).not.toContain("vm-bridge.js");
  expect(strFromU8(unzipped["vibe-motion.css"])).toContain(elementClass);
});

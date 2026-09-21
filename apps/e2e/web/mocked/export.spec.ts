import { expect, test, type FrameLocator, type Page } from "@playwright/test";

/**
 * The Export tab as a designer reaches it: the real tab, in the real editor,
 * over the MSW mock api (`apps/web/mocks/`). `/dev/export` stages the panel
 * from fixed props; this is the wiring around it — which version is exported,
 * what the guard does on the way in, and what the History tab's "Export vN"
 * opens (Phase 7 Track C).
 *
 * The bundle's *bytes* are the API's business: the mock's CSS keys off
 * `data-vm-id` where the real exporter emits `vm-a<N>` classes (DT-033), so
 * nothing here asserts on what a rule looks like — only that a snippet is of
 * the element that was selected, which is true of either shape.
 * `../stack/export-ui.spec.ts` asserts the real exporter's own bytes.
 */

const HEADING = "vm-heading";
const PARAGRAPH = "vm-paragraph";

function preview(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Cloned page preview"]');
}

function panel(page: Page) {
  return page.getByTestId("panel-export");
}

async function openEditor(page: Page, url = "https://example.com"): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Page URL").fill(url);
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/.+/);
  // A click in the frame means nothing until the bridge has handshaked.
  await expect(preview(page).locator("[data-vm-overlay]")).toBeAttached();
}

/** Click an element in the preview and give it Fade In Up, landing on tuning. */
async function animate(page: Page, vmId: string): Promise<void> {
  await preview(page).locator(`[data-vm-id="${vmId}"]`).click();
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

test("exports the current version, with the files the zip will hold", async ({ context, page }) => {
  // Chromium refuses `navigator.clipboard` without these.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openEditor(page);
  await animate(page, HEADING);
  await saveVersion(page, 1);

  await page.getByRole("tab", { name: "Export" }).click();

  await expect(panel(page)).toBeVisible();
  // "EXPORTING · v1 · current", the handoff's header.
  await expect(panel(page).getByText("v1", { exact: true })).toBeVisible();
  await expect(panel(page).getByText("· current")).toBeVisible();
  // One tab per file the download will contain, opened on the stylesheet.
  await expect(panel(page).getByRole("tab", { name: "index.html" })).toBeVisible();
  await expect(panel(page).getByRole("tab", { name: "vibe-motion.css" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel(page).getByTestId("export-stats")).toContainText("1 animation · 1 element");

  await panel(page).getByRole("button", { name: "Copy vibe-motion.css" }).click();
  await expect(page.locator('[data-slot="toaster"]')).toContainText("Copied CSS");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.length).toBeGreaterThan(0);
});

test("offers Snippet only for an element this version animates", async ({ page }) => {
  await openEditor(page);
  await animate(page, HEADING);
  await saveVersion(page, 1);
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(panel(page)).toBeVisible();

  // The animated element is still the selected one, so a snippet is available.
  await expect(panel(page).getByRole("radio", { name: "Snippet" })).not.toHaveAttribute(
    "data-disabled",
  );

  // Selecting an element with no animation takes it away, with the reason on
  // screen rather than a dimmed control and no explanation.
  await preview(page).locator(`[data-vm-id="${PARAGRAPH}"]`).click();
  await expect(panel(page).getByRole("radio", { name: "Snippet" })).toHaveAttribute(
    "data-disabled",
  );
  await expect(panel(page).getByText(/Select an animated element/)).toBeVisible();

  // Back to the animated one, and Snippet is a single stylesheet for it.
  await preview(page).locator(`[data-vm-id="${HEADING}"]`).click();
  await panel(page).getByRole("radio", { name: "Snippet" }).click();

  await expect(panel(page).getByRole("tab", { name: "index.html" })).toHaveCount(0);
  await expect(panel(page).getByRole("tab", { name: "vibe-motion.css" })).toBeVisible();
  await expect(panel(page).getByTestId("export-stats")).toContainText("1 animation · 1 element");
  // The snippet is of the element that was selected. Identified by its vmId
  // because that is what *this* mock keys its rules off; the real exporter
  // writes a `vm-a<N>` class for the same element (DT-033), and the stack
  // spec is where that shape is asserted.
  await expect(page.getByRole("region", { name: "vibe-motion.css" })).toContainText(HEADING);
});

test("unsaved changes are saved first, and Export opens on the new version", async ({ page }) => {
  await openEditor(page);
  await animate(page, HEADING);
  await saveVersion(page, 1);

  // Something the reader has not saved yet.
  const duration = page.getByRole("spinbutton", { name: "Duration value" });
  await duration.fill("900");
  await duration.press("Enter");
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();

  await page.getByRole("tab", { name: "Export" }).click();

  // The guard, not the export: nothing may be built from a draft no version
  // contains (docs/user_flow.md §5).
  const guard = page.getByRole("dialog", { name: /Save changes/ });
  await expect(guard).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  await guard.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save version" }).click();

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("v2", { exact: true })).toBeVisible();
  await expect(panel(page).getByText("· current")).toBeVisible();
  await expect(page.getByTestId("unsaved-indicator")).toHaveCount(0);
});

test("Keep editing leaves the draft and the tab exactly where they were", async ({ page }) => {
  await openEditor(page);
  await animate(page, HEADING);

  await page.getByRole("tab", { name: "Export" }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect(page.getByRole("tab", { name: "Animate" })).toHaveAttribute("data-active");
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
});

/**
 * A real clone is a whole web page, so `index.html` in the Export tab is
 * thousands of lines — the mock stands in for one with `?vmExtraElements=N`,
 * the same knob the preview route has.
 */
const BIG_PAGE = "https://example.com/?vmExtraElements=800";

for (const viewport of [
  { width: 1440, height: 900 },
  // A short window is where an unbounded panel hides the buttons first.
  { width: 1280, height: 640 },
]) {
  test(`the panel fits the column and the code scrolls inside it (${viewport.width}x${viewport.height})`, async ({
    page,
  }) => {
    // jsdom cannot measure layout, so this is the only place the Export
    // panel's height chain is actually checked. Without a bounded height the
    // panel grows to the length of the file — tens of thousands of pixels —
    // the `<pre>` never scrolls, and Copy all / Download .zip sit far below
    // the fold on a tab whose whole point is downloading.
    await page.setViewportSize(viewport);
    await openEditor(page, BIG_PAGE);
    await animate(page, HEADING);
    await saveVersion(page, 1);
    await page.getByRole("tab", { name: "Export" }).click();
    await expect(panel(page)).toBeVisible();

    // The long file, not the short stylesheet the tab opens on.
    await panel(page).getByRole("tab", { name: "index.html" }).click();
    const code = page.getByRole("region", { name: "index.html" });
    await expect(code).toBeVisible();

    const box = await panel(page).boundingBox();
    expect(box, "the export panel has a box").not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);

    // The code block is what scrolls, and it really does have more to show.
    const overflow = await code.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(overflow.clientHeight).toBeGreaterThan(0);
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

    // …so the actions are reachable without scrolling the column at all.
    await expect(panel(page).getByRole("button", { name: "Download .zip" })).toBeInViewport();
    await expect(panel(page).getByRole("button", { name: "Copy all" })).toBeInViewport();
    await expect(panel(page).getByTestId("export-stats")).toBeInViewport();
  });
}

test("Export vN in the History tab opens that version (DT-160)", async ({ page }) => {
  await openEditor(page);
  await animate(page, HEADING);
  await saveVersion(page, 1);
  const duration = page.getByRole("spinbutton", { name: "Duration value" });
  await duration.fill("900");
  await duration.press("Enter");
  await saveVersion(page, 2);

  await page.getByRole("tab", { name: "History" }).click();
  // Expanding v1 is what puts it on screen read-only — and the only place its
  // Export button exists.
  await page.getByTestId("panel-history").getByText("v1", { exact: true }).click();
  await expect(page.getByText("Viewing v1 · read-only")).toBeVisible();

  await page.getByRole("button", { name: "Export v1" }).click();

  await expect(page.getByRole("tab", { name: "Export" })).toHaveAttribute("data-active");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("v1", { exact: true })).toBeVisible();
  // v1 is not the current version, and the panel says so by not saying so.
  await expect(panel(page).getByText("· current")).toHaveCount(0);
  // Leaving History put the canvas back on the current version (user_flow §4).
  await expect(page.getByText("Viewing v1 · read-only")).toHaveCount(0);
});

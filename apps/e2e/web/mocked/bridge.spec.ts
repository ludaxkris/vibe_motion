import { expect, test, type FrameLocator, type Page } from "@playwright/test";

/**
 * Phase 4's exit criterion, end to end: clicking an element inside the preview
 * iframe selects it, picking an animation applies real CSS inside that frame,
 * and tuning a param updates the element without a single API call.
 *
 * Mocked, and genuinely cross-origin: the shell is on `localhost:3000` and the
 * cloned page on `127.0.0.1:3000` (`apps/web/lib/preview-url.ts`), served by
 * the Next mock route with the API's own CSP and the *real*
 * `packages/bridge/src/vm-bridge.js`. So the bridge's origin checks are
 * exercised here exactly as they are in production (spec §2). The same flow
 * against the real api and a real clone is `../stack/bridge.spec.ts`.
 */

const KEYFRAMES = "vm-fade-in-up-v1-1-0";

function preview(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Cloned page preview"]');
}

/** What the overlay says is selected, read from inside the frame (spec §4). */
function ring(page: Page) {
  return preview(page).locator("[data-vm-overlay]");
}

async function openEditor(page: Page) {
  await page.goto("/");
  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/.+/);
  // The frame has to have handshaked before a click in it means anything.
  await expect(preview(page).locator("[data-vm-overlay]")).toBeAttached();
}

/** The computed value of one property on a tagged element inside the frame. */
function computed(page: Page, vmId: string, property: string) {
  return preview(page)
    .locator(`[data-vm-id="${vmId}"]`)
    .evaluate(
      (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim(),
      property,
    );
}

/** What the element's *inline* style says — what the bridge itself wrote. */
function inline(page: Page, vmId: string, property: string) {
  return preview(page)
    .locator(`[data-vm-id="${vmId}"]`)
    .evaluate((el, prop) => (el as HTMLElement).style.getPropertyValue(prop), property);
}

async function applyFadeInUp(page: Page) {
  await page.getByRole("button", { name: "Choose custom animation" }).click();
  await page.getByRole("button", { name: "Fade In Up", exact: true }).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
}

test("select an element, animate it, and tune it — with no API call in the loop", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  await openEditor(page);

  // Everything the editor legitimately fetches (project, versions, catalog)
  // has happened by now; from here the live-edit loop must be silent
  // (CLAUDE.md rule 9).
  page.on("request", (request) => {
    const url = request.url();
    if (/\/projects\/[^/]+\/versions/.test(url)) apiCalls.push(`${request.method()} ${url}`);
  });

  await preview(page).locator('[data-vm-id="vm-heading"]').click();

  await expect(page.getByTestId("panel-selected")).toBeVisible();
  await expect(page.getByTestId("panel-selected")).toContainText("vm-heading");
  // The ring moved only because the shell answered with `select` (spec D10).
  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-heading");
  await expect(preview(page).locator("[data-vm-overlay-label]")).toHaveText("h1");

  await applyFadeInUp(page);

  // The pinned catalog version is in the name, and the keyframes body is in
  // the frame's own runtime sheet.
  await expect(async () => {
    expect(await computed(page, "vm-heading", "animation-name")).toBe(KEYFRAMES);
  }).toPass();
  const runtime = await preview(page)
    .locator("#vm-runtime")
    .evaluate((style) =>
      Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])
        .map((rule) => rule.cssText)
        .join("\n"),
    );
  expect(runtime).toContain(KEYFRAMES);

  // Picking an animation also refreshes the ring's caption without moving it.
  await expect(preview(page).locator("[data-vm-overlay-label]")).toHaveText("h1 · Fade In Up");

  const duration = page.getByRole("spinbutton", { name: "Duration value" });
  await duration.fill("1200");
  await duration.press("Enter");

  // Inline, `!important`, written by the bridge: the param path never touches
  // the stylesheet (spec §6).
  await expect(async () => {
    expect(await inline(page, "vm-heading", "animation-duration")).toBe("1200ms");
  }).toPass();

  await page.getByRole("button", { name: "Remove animation" }).click();

  await expect(async () => {
    expect(await inline(page, "vm-heading", "animation-name")).toBe("");
  }).toPass();
  expect(await computed(page, "vm-heading", "animation-name")).toBe("none");

  expect(apiCalls).toEqual([]);
});

test("Replay restarts the animation without changing the draft", async ({ page }) => {
  await openEditor(page);
  await preview(page).locator('[data-vm-id="vm-heading"]').click();
  await applyFadeInUp(page);

  const started = () =>
    preview(page)
      .locator('[data-vm-id="vm-heading"]')
      .evaluate((el) => el.getAnimations().length);

  await expect(async () => expect(await started()).toBeGreaterThan(0)).toPass();

  await page.getByRole("button", { name: "Replay" }).click();

  // A fresh animation, back near the start of its 600ms run.
  await expect(async () => {
    const time = await preview(page)
      .locator('[data-vm-id="vm-heading"]')
      .evaluate((el) => Number(el.getAnimations()[0]?.currentTime ?? -1));
    expect(time).toBeGreaterThanOrEqual(0);
    expect(time).toBeLessThan(600);
  }).toPass();
});

test("hovering a card previews it on the page without touching the draft", async ({ page }) => {
  await openEditor(page);
  await preview(page).locator('[data-vm-id="vm-heading"]').click();
  await page.getByRole("button", { name: "Choose custom animation" }).click();

  await page.getByRole("button", { name: "Pulse", exact: true }).hover();

  await expect(async () => {
    expect(await computed(page, "vm-heading", "animation-name")).toContain("vm-pulse-v1");
  }).toPass();
  // A preview is not a pick: the panel is still the picker, nothing applied.
  await expect(page.getByTestId("panel-choosing")).toBeVisible();

  // Move the pointer off every card.
  await page.getByRole("searchbox", { name: "Search animations" }).hover();

  await expect(async () => {
    expect(await computed(page, "vm-heading", "animation-name")).toBe("none");
  }).toPass();
});

test("switching away from a dirty element asks first, and the ring does not move", async ({
  page,
}) => {
  await openEditor(page);
  await preview(page).locator('[data-vm-id="vm-heading"]').click();
  await applyFadeInUp(page);

  // A click on another element inside the frame is a *request* (spec D10).
  await preview(page).locator('[data-vm-id="vm-button"]').click();

  await expect(page.getByText("Save changes to h1?")).toBeVisible();
  // Still on the heading: ring, label and panel all agree.
  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-heading");
  await expect(page.getByTestId("panel-tuning")).toContainText("vm-heading");
  // Phase 6 gave the guard a save it can actually perform.
  await expect(page.getByRole("button", { name: "Save" }).last()).toBeEnabled();

  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect(page.getByText("Save changes to h1?")).toBeHidden();
  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-heading");
  expect(await inline(page, "vm-heading", "animation-name")).toBe(KEYFRAMES);

  // Ask again, and discard this time.
  await preview(page).locator('[data-vm-id="vm-button"]').click();
  await expect(page.getByText("Save changes to h1?")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();

  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-button");
  await expect(page.getByTestId("panel-selected")).toContainText("vm-button");
  await expect(async () => {
    expect(await inline(page, "vm-heading", "animation-name")).toBe("");
  }).toPass();
});

test("a clean element switches with no dialog, and Escape deselects only when clean", async ({
  page,
}) => {
  await openEditor(page);

  await preview(page).locator('[data-vm-id="vm-heading"]').click();
  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-heading");

  await preview(page).locator('[data-vm-id="vm-button"]').click();

  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-button");

  // Escape *inside the frame* while clean: the bridge reports it and the shell
  // honours it.
  await preview(page).locator("body").press("Escape");
  await expect(ring(page)).not.toHaveAttribute("data-vm-selected", /.+/);
  await expect(page.getByTestId("panel-idle")).toBeVisible();

  // …and while dirty it does nothing at all, rather than raising a dialog the
  // designer did not ask for (spec §5).
  await preview(page).locator('[data-vm-id="vm-heading"]').click();
  await applyFadeInUp(page);

  await preview(page).locator("body").press("Escape");

  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(ring(page)).toHaveAttribute("data-vm-selected", "vm-heading");
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";

import { stack } from "./env";

/**
 * The selection bridge against the real thing: the production web build frames
 * a page the api cloned from a fixture, served off the api's own origin with
 * the api's own CSP and the bridge script out of the api jar. Nothing here is
 * mocked, and the `postMessage` origin checks (spec §2) are the production
 * ones.
 *
 * `../mocked/bridge.spec.ts` is the same flow against the mock page route, and
 * covers the guard and the no-API-call assertion in detail. This one exists to
 * prove the real serving path: real clone, real script, real origins.
 *
 * **A real clone numbers its elements `vm-1`, `vm-2`, …** (`HtmlRewriter`), so
 * the mock fixture's `vm-heading` ids do not exist here. Elements are found by
 * the fixture's own markup and their `data-vm-id` read off them.
 */

const FIXTURE_URL = `${stack.fixtureOrigin}/marketing.html`;
const KEYFRAMES = /^vm-fade-in-up-v\d+-\d+-\d+$/;

function preview(page: Page) {
  return page.frameLocator('iframe[title="Cloned page preview"]');
}

async function cloneFixture(page: Page) {
  await page.goto("/");
  await page.getByLabel("Page URL").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Clone" }).click();
  // A real clone: fetch, parse, rewrite, instrument, insert. Give the JVM room.
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });
  // The overlay only exists once the bridge has handshaked.
  await expect(preview(page).locator("[data-vm-overlay]")).toBeAttached({ timeout: 30_000 });
}

test("clicking a cloned element selects it, and an animation applies inside the frame", async ({
  page,
}) => {
  const writes: string[] = [];
  await cloneFixture(page);

  const headline = preview(page).locator("#headline");
  const vmId = await headline.getAttribute("data-vm-id");
  expect(vmId).toMatch(/^vm-\d+$/);

  // From here the live-edit loop must not write to the api (CLAUDE.md rule 9).
  page.on("request", (request) => {
    if (request.method() === "GET") return;
    if (request.url().startsWith(stack.apiOrigin)) writes.push(`${request.method()} ${request.url()}`);
  });

  await headline.click();

  await expect(page.getByTestId("panel-selected")).toBeVisible();
  await expect(page.getByTestId("panel-selected")).toContainText(vmId!);
  // Spec D10: the ring moved because the shell answered `select`, not because
  // the bridge moved it on the click.
  await expect(preview(page).locator("[data-vm-overlay]")).toHaveAttribute(
    "data-vm-selected",
    vmId!,
  );

  await page.getByRole("button", { name: "Choose custom animation" }).click();
  await page.getByRole("button", { name: "Fade In Up", exact: true }).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();

  await expect(async () => {
    const name = await headline.evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toMatch(KEYFRAMES);
  }).toPass();

  const runtime = await preview(page)
    .locator("#vm-runtime")
    .evaluate((style) =>
      Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])
        .map((rule) => rule.cssText)
        .join("\n"),
    );
  expect(runtime).toMatch(/@keyframes vm-fade-in-up-v/);

  const duration = page.getByRole("spinbutton", { name: "Duration value" });
  await duration.fill("1200");
  await duration.press("Enter");

  await expect(async () => {
    const value = await headline.evaluate((el) => (el as HTMLElement).style.animationDuration);
    expect(value).toBe("1200ms");
  }).toPass();

  await page.getByRole("button", { name: "Remove animation" }).click();
  await expect(async () => {
    const value = await headline.evaluate((el) => (el as HTMLElement).style.animationName);
    expect(value).toBe("");
  }).toPass();

  expect(writes).toEqual([]);
});

test("switching away from a dirty cloned element raises the guard and holds the ring", async ({
  page,
}) => {
  await cloneFixture(page);

  const headline = preview(page).locator("#headline");
  const cta = preview(page).locator(".cta");
  const headlineId = await headline.getAttribute("data-vm-id");

  await headline.click();
  await page.getByRole("button", { name: "Choose custom animation" }).click();
  await page.getByRole("button", { name: "Fade In Up", exact: true }).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();

  await cta.click();

  // The clone's own tag names the element, because the bridge reported it.
  await expect(page.getByText("Save changes to h1?")).toBeVisible();
  await expect(preview(page).locator("[data-vm-overlay]")).toHaveAttribute(
    "data-vm-selected",
    headlineId!,
  );

  await page.getByRole("button", { name: "Discard" }).click();

  const ctaId = await cta.getAttribute("data-vm-id");
  await expect(preview(page).locator("[data-vm-overlay]")).toHaveAttribute(
    "data-vm-selected",
    ctaId!,
  );
  await expect(async () => {
    const value = await headline.evaluate((el) => (el as HTMLElement).style.animationName);
    expect(value).toBe("");
  }).toPass();
});

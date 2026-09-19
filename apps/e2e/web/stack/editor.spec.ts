import { expect, test } from "@playwright/test";

import { stack } from "./env";

/**
 * The product's first flow, end to end and with nothing faked: the Entry
 * screen of the production web build posts to the real api image, which clones
 * a fixture page through the unmodified SSRF guard into Postgres, and the
 * editor frames what came back off the api's own origin.
 *
 * `../mocked/editor.spec.ts` is the same flow against the MSW mocks, where the
 * clone is instant and its result fixed.
 */

/**
 * Plain http: the fixture server has no TLS. The Entry field's prefix is
 * `https://` and `stripHttpsScheme` drops only that scheme, so a typed
 * `http://` survives the field and `hasExplicitScheme` hides the prefix —
 * which is the only way to clone a plain-http page (`lib/source-url.ts`).
 */
const FIXTURE_URL = `${stack.fixtureOrigin}/marketing.html`;
const FIXTURE_LABEL = FIXTURE_URL.replace(/^https?:\/\//, "");

test("cloning a fixture page from the Entry screen opens it in the editor", async ({ page }) => {
  await page.goto("/");

  const field = page.getByLabel("Page URL");
  await field.fill(FIXTURE_URL);
  // The scheme is the value's, not the prefix's, so nothing was stripped.
  await expect(field).toHaveValue(FIXTURE_URL);

  await page.getByRole("button", { name: "Clone" }).click();

  // A real clone: fetch, parse, rewrite, instrument, insert. Give the JVM room.
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });

  // The editor's heading is sr-only; the bar carries the same host+path.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Editing ${FIXTURE_LABEL}`);
  await expect(page.getByRole("banner")).toContainText(FIXTURE_LABEL);

  // Nothing has been changed yet, so neither action is live.
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  const preview = page.getByRole("region", { name: "Preview" });
  const clone = preview.getByTitle("Cloned page preview").contentFrame();

  // The api serves this from `base_html`, cross-origin to the web app, under
  // the clone CSP — and it is the fixture, instrumented and script-free.
  await expect(clone.getByRole("heading", { name: "Ship motion, not tickets" })).toBeVisible();
  await expect(clone.getByRole("heading", { name: "Ship motion, not tickets" })).toHaveAttribute(
    "data-vm-id",
    /.+/,
  );
  await expect(clone.locator("html")).not.toHaveAttribute("data-fixture-script-ran", "yes");

  await expect(page.getByRole("complementary", { name: "Control Panel" })).toBeVisible();
});

test("a project cloned from the real api comes back under Recent projects", async ({ page }) => {
  await page.goto("/");

  // Scoped to this browser context's localStorage, so a parallel worker's
  // project can never show up here.
  await expect(page.getByRole("region", { name: "Recent projects" })).toHaveCount(0);

  await page.getByLabel("Page URL").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });

  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent projects" });
  // The title is the cloned page's own `<title>`, straight from the api.
  await expect(recent.getByRole("link", { name: /^Open Acme/ })).toBeVisible();
});

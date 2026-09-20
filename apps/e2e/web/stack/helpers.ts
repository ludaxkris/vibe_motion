import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";

import { stack } from "./env";

/**
 * Shared by the full-stack specs that drive the editor against a real clone.
 *
 * **A real clone numbers its elements `vm-1`, `vm-2`, …** (`HtmlRewriter`), so
 * find elements by the fixture's own markup and read `data-vm-id` off them.
 *
 * `window.__vmTest` does not exist here: the stack runs the production web
 * build. Everything below observes the page from outside, the way a user's
 * browser would.
 */

export const FIXTURE_URL = `${stack.fixtureOrigin}/marketing.html`;

const PREVIEW_FRAME = 'iframe[title="Cloned page preview"]';
const RECORDER_KEY = "__vmE2eReceived";

/** The cloned page, inside the editor's preview iframe. */
export function preview(page: Page): FrameLocator {
  return page.frameLocator(PREVIEW_FRAME);
}

/** Clones the marketing fixture from the Entry screen and waits for the bridge handshake. */
export async function cloneFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Page URL").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Clone" }).click();
  // A real clone: fetch, parse, rewrite, instrument, insert. Give the JVM room.
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });
  // The overlay only exists once the bridge has handshaked.
  await expect(preview(page).locator("[data-vm-overlay]")).toBeAttached({ timeout: 30_000 });
}

/**
 * The element's INLINE style value (`""` when unset), never the computed one:
 * the bridge writes the `animation-*` group inline only while a trigger is
 * armed (protocol spec D3), and that is what these specs assert on.
 */
export async function inline(element: Locator, prop: string): Promise<string> {
  return element.evaluate(
    (el, name) => (el as HTMLElement).style.getPropertyValue(name),
    prop,
  );
}

/**
 * Records the `type` of every Vibe Motion message the preview frame RECEIVES,
 * i.e. everything the shell posts to the bridge. Call before navigating: it is
 * an init script, installed in the framed document only, and its listener is
 * added before the bridge's own.
 */
export async function installMessageRecorder(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (window.parent === window) return;
    const received: string[] = [];
    (window as unknown as Record<string, string[]>)[key] = received;
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (!data || data.source !== "vibe-motion" || typeof data.type !== "string") return;
      received.push(data.type);
    });
  }, RECORDER_KEY);
}

/** Every message type the preview frame has received so far, in order. */
export async function receivedTypes(page: Page): Promise<string[]> {
  return page
    .locator(PREVIEW_FRAME)
    .contentFrame()
    .locator("html")
    .evaluate(
      (_html, key) => ((window as unknown as Record<string, string[] | undefined>)[key] ?? []).slice(),
      RECORDER_KEY,
    );
}

/**
 * Counts `POST …/projects/<id>/versions`: the one request that creates a
 * version. Call before navigating; the getter reads the count so far.
 */
export function watchVersionPosts(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (/\/projects\/[^/]+\/versions\/?(\?.*)?$/.test(request.url())) count += 1;
  });
  return () => count;
}

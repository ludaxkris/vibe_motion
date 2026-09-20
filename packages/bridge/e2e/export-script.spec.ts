import { expect, test } from "@playwright/test";

import { exportedCss, mountExport } from "./harness";

/**
 * `src/vibe-motion-export.js`, in a real browser.
 *
 * This is the whole of what an exported page needs JavaScript for: add `vm-js` to `<html>` before
 * the first paint, then release each `.vm-in-view` element from the stylesheet's hold rule when it
 * has been scrolled to. Everything here is invisible to jsdom — a real `IntersectionObserver`, a
 * real `rootBounds`, real layout and real animations with a real `currentTime`.
 *
 * The rule the whole file exists to keep: **nothing may be left held at `opacity: 0`.** Every
 * failure path plays everything.
 */

const KEYFRAMES = "vm-fade-in-up-v1-1-0";
const CSS = exportedCss(["vm-a1"]);

const BELOW_THE_FOLD = `<div class="spacer"></div><div id="target" class="box vm-a1 vm-in-view">target</div>`;

test.use({ reducedMotion: "no-preference", viewport: { width: 640, height: 400 } });

test("adds vm-js to <html> before the first paint", async ({ page }) => {
  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });

  // The script tag is in `<head>` and not deferred for exactly this reason: with `defer` the
  // element would paint at rest, snap to its first keyframe when the class landed, and then play.
  expect(await page.evaluate(() => window.__firstFrameClass)).toContain("vm-js");
  expect(await harness.frame.evaluate(() => document.documentElement.className)).toContain("vm-js");
});

test("holds an element below the fold on its first keyframe, at currentTime 0", async ({ page }) => {
  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });

  const held = await harness.animation("#target");
  expect(held).toMatchObject({ name: KEYFRAMES, state: "paused", time: 0 });
  expect(await harness.classes("#target")).not.toContain("vm-play");
  // Held, not hidden: the animation exists and is simply paused at its start.
  expect(await harness.frame.evaluate(() => getComputedStyle(document.querySelector("#target")!).opacity)).toBe("0");
});

test("plays when it is scrolled to, and never plays a second time", async ({ page }) => {
  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });

  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
  expect(await harness.classes("#target")).toContain("vm-play");
  expect(await harness.starts(KEYFRAMES)).toBe(1);

  // Out of view and back again: the element was unobserved on the way, so nothing restarts.
  await harness.frame.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await page.waitForTimeout(150);

  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("an element taller than five viewports fires on first intersection", async ({ page }) => {
  // DT-095: `intersectionRatio` can never reach the 0.2 threshold for an element this tall, so the
  // corrected condition compares its height against the root's instead.
  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="vm-a1 vm-in-view" style="height:600vh;background:#ddd"></div>`,
    css: CSS,
  });

  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });

  await harness.frame.evaluate(() => window.scrollTo(0, 1900));
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("inside a cross-origin iframe, where rootBounds is null, it still plays", async ({ page }) => {
  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS, embed: true });

  // Reading `.height` off this would throw and leave every element held forever.
  const rootBoundsIsNull = await harness.frame.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const observer = new IntersectionObserver((entries) => {
          observer.disconnect();
          resolve(entries[0].rootBounds === null);
        });
        observer.observe(document.body);
      }),
  );
  expect(rootBoundsIsNull).toBe(true);

  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });
  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
});

test("with no IntersectionObserver at all, everything plays", async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error removing a browser global on purpose
    delete window.IntersectionObserver;
  });

  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
  expect(await harness.animation("#target")).toMatchObject({ state: "running" });
});

test("a callback that throws plays everything rather than leaving it held", async ({ page }) => {
  await page.addInitScript(() => {
    class BrokenObserver {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      // An entry with no `boundingClientRect`: reading `.height` off it throws.
      observe(): void {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
      }

      unobserve(): void {}

      disconnect(): void {}
    }
    // @ts-expect-error replacing a browser global with a deliberately broken one
    window.IntersectionObserver = BrokenObserver;
  });

  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="box vm-a1 vm-in-view">a</div>` + `<div id="other" class="box vm-a1 vm-in-view">b</div>`,
    css: CSS,
  });

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
  expect(await harness.classes("#other")).toContain("vm-play");
});

test("a page with no in-view elements still gets vm-js and runs without error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const harness = await mountExport(page, { body: `<p id="plain">nothing to observe</p>`, css: CSS });

  expect(await harness.frame.evaluate(() => document.documentElement.className)).toContain("vm-js");
  expect(errors).toEqual([]);
});

test("the script never touches an element that is not marked", async ({ page }) => {
  const harness = await mountExport(page, {
    body: `<div id="marked" class="box vm-a1 vm-in-view">a</div><div id="plain" class="box vm-a1">b</div>`,
    css: CSS,
  });

  await expect.poll(async () => await harness.classes("#marked")).toContain("vm-play");
  expect(await harness.classes("#plain")).toBe("box vm-a1");
});

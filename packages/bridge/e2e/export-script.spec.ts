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
  //
  // Polled, not read once: a headless page under parallel workers may not have produced its first
  // frame by the time `goto` resolves, and reading `null` then says nothing. What is asserted is
  // unchanged — the class recorded *at* the first frame, whenever that frame happens.
  await expect.poll(async () => await page.evaluate(() => window.__firstFrameClass)).toContain("vm-js");
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

test("a track wider than the viewport, whose ratio is unreachable, fires on first intersection", async ({ page }) => {
  // DT-095 is not only about height. Inside a horizontal scroller a 4000px track can show at most
  // 640/4000 = 0.16 of itself, so the ratio test can never succeed and a height-only rule leaves
  // it held at `opacity: 0` for good.
  const harness = await mountExport(page, {
    body:
      `<div class="spacer"></div>` +
      `<div style="overflow-x:auto;width:600px">` +
      `<div id="target" class="vm-a1 vm-in-view" style="width:4000px;height:60px;background:#ddd"></div></div>`,
    css: CSS,
  });

  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });

  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("an element both wider and taller than the viewport fires on first intersection", async ({ page }) => {
  // Reachability is an area, not a height: 640/1280 x 400/1200 = 0.17, under the threshold on
  // neither axis alone.
  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="vm-a1 vm-in-view" style="width:1280px;height:1200px;background:#ddd"></div>`,
    css: CSS,
  });

  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });

  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
});

test("an element exactly five viewports tall is on the boundary, and fires", async ({ page }) => {
  // `min(1, 640/640) * min(1, 400/2000)` is exactly 0.2. With a strict `<` this element would be
  // left to reach the threshold by perfect alignment, which is float rounding deciding whether an
  // animation ever plays.
  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="vm-a1 vm-in-view" style="height:2000px;background:#ddd"></div>`,
    css: CSS,
  });

  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });

  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
});

test("an element that fits comfortably still waits for the real threshold", async ({ page }) => {
  // The reachability escape hatch must not swallow the ordinary case: this box can reach ratio 1,
  // so it is held until it is actually on screen.
  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });

  await harness.frame.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });
  // `vm-play` is the whole claim: the reachability escape hatch did not fire for a box that can
  // reach ratio 1 on its own. (`animationstart` is no use here — a held animation has already
  // fired one; it is paused, not absent.)
  expect(await harness.classes("#target")).not.toContain("vm-play");
});

test("an element added after DOMContentLoaded is observed, held, and plays when it is reached", async ({ page }) => {
  // Snippet mode exists to be pasted into someone else's site, and those are frequently
  // client-rendered: an element that arrives late must be picked up, not force-played and not
  // left held for ever.
  const harness = await mountExport(page, { body: `<div class="spacer"></div><div id="host"></div>`, css: CSS });

  await harness.frame.evaluate(() => {
    const late = document.createElement("div");
    late.id = "late";
    late.className = "box vm-a1 vm-in-view";
    document.querySelector("#host")!.append(late);
  });
  await page.waitForTimeout(150);

  // Observed, not blanket-played: it is still waiting its turn.
  expect(await harness.animation("#late")).toMatchObject({ name: KEYFRAMES, state: "paused", time: 0 });

  await harness.frame.evaluate(() => document.querySelector("#late")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#late"))?.state).toBe("running");
});

test("a marked element deep inside a late subtree is observed too", async ({ page }) => {
  const harness = await mountExport(page, { body: `<div id="host"></div>`, css: CSS });

  await harness.frame.evaluate(() => {
    const wrapper = document.createElement("section");
    wrapper.innerHTML = `<div><p id="late" class="box vm-a1 vm-in-view">late</p></div>`;
    document.querySelector("#host")!.append(wrapper);
  });

  // In the first viewport, so it plays straight away once it is observed.
  await expect.poll(async () => await harness.classes("#late")).toContain("vm-play");
});

test("a host re-render that rewrites class does not re-hold an element that has played", async ({
  page,
}) => {
  // DT-187. Snippet mode is pasted into someone else's site, and a React/Vue
  // host owns `class` on the elements it renders: the next re-render writes
  // `className` back from its own state and `vm-play` is gone. The element was
  // unobserved when it played, so nothing would ever put it back — and
  // `.vm-in-view:not(.vm-play)` pauses it at its first keyframe for good.
  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });

  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());
  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");

  await harness.frame.evaluate(() => {
    // Exactly what a framework re-render does: the whole attribute, from its
    // own state, with no idea `vm-play` was ever there.
    document.querySelector("#target")!.className = "box vm-a1 vm-in-view";
  });

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
  expect(await harness.animation("#target")).toMatchObject({ state: "running" });
  // Restored, not restarted: the animation is the same one, still running.
  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("restoring vm-play does not loop, and leaves other elements alone", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const harness = await mountExport(page, {
    body:
      `<div id="played" class="box vm-a1 vm-in-view">a</div>` +
      `<div class="spacer"></div>` +
      `<div id="waiting" class="box vm-a1 vm-in-view">b</div>`,
    css: CSS,
  });

  await expect.poll(async () => await harness.classes("#played")).toContain("vm-play");

  await harness.frame.evaluate(() => {
    document.querySelector("#played")!.className = "box vm-a1 vm-in-view";
    // A class change on an element that never played must not force it open:
    // it is below the fold and still waiting its turn.
    document.querySelector("#waiting")!.className = "box vm-a1 vm-in-view highlighted";
  });
  await page.waitForTimeout(200);

  expect(await harness.classes("#played")).toContain("vm-play");
  expect(await harness.classes("#waiting")).not.toContain("vm-play");
  expect(await harness.animation("#waiting")).toMatchObject({ state: "paused", time: 0 });
  expect(errors).toEqual([]);
});

test("an element that gains vm-in-view by a class rewrite is observed, held, and plays", async ({
  page,
}) => {
  // The mirror of the repair above, and the one snippet mode was written for:
  // `className={open ? "vm-a1 vm-in-view" : "vm-a1"}` on a framework host adds
  // the marker with no node insertion at all. Nothing observes it, and
  // `.vm-in-view:not(.vm-play)` holds it at `opacity: 0` for good — against
  // this file's overriding rule.
  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="box vm-a1">target</div>`,
    css: CSS,
  });

  await harness.frame.evaluate(() => {
    document.querySelector("#target")!.className = "box vm-a1 vm-in-view";
  });
  await page.waitForTimeout(150);

  // Held, not force-played: it is below the fold and has not been reached.
  // (Paused wherever it had got to, not at 0: this element carried `vm-a1`
  // without the marker until now, so its animation had already started and the
  // hold rule caught it mid-flight. An element the *exporter* marks carries
  // both classes from the first paint and is held at 0, as the specs above.)
  expect(await harness.classes("#target")).not.toContain("vm-play");
  expect(await harness.animation("#target")).toMatchObject({ state: "paused" });

  await harness.frame.evaluate(() => document.querySelector("#target")!.scrollIntoView());

  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("with no IntersectionObserver, an element that gains the marker is played on sight", async ({
  page,
}) => {
  // Nothing can observe it, and the hold rule applies the moment the marker
  // lands, so the only answer that keeps it visible is to release it.
  await page.addInitScript(() => {
    // @ts-expect-error removing a browser global on purpose
    delete window.IntersectionObserver;
  });

  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="box vm-a1">target</div>`,
    css: CSS,
  });

  await harness.frame.evaluate(() => {
    document.querySelector("#target")!.className = "box vm-a1 vm-in-view";
  });

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
});

test("with no IntersectionObserver, a played element is still restored after a re-render", async ({
  page,
}) => {
  // The fallback path plays everything; a host re-render would drop `vm-play`
  // there too, and the hold rule applies just the same.
  await page.addInitScript(() => {
    // @ts-expect-error removing a browser global on purpose
    delete window.IntersectionObserver;
  });

  const harness = await mountExport(page, { body: BELOW_THE_FOLD, css: CSS });
  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");

  await harness.frame.evaluate(() => {
    document.querySelector("#target")!.className = "box vm-a1 vm-in-view";
  });

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
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

test("a collapsed root does not count as 'seen': the element waits for a viewport", async ({
  page,
}) => {
  // The reachability escape hatch asks "could this element ever reach the threshold in a root
  // this size?". With a root of height 0 — an exported page inside a collapsed iframe, a closed
  // accordion, a transient zero-height layout — the honest answer is "there is no viewport yet".
  // `min(1, 0 / h)` is 0, which is under the threshold, so an element the browser reports as
  // edge-adjacent would fire unseen; the export unobserves what it plays, so it would then never
  // play for the reader at all. `reachableFraction` guards `rootSize` for that reason, and
  // `test/export-script.test.ts` is where that arithmetic is pinned.
  //
  // What this spec holds is the behaviour: in a root with no size nothing is released, and the
  // element still plays once a viewport appears. (Chromium reports no intersection at all in a
  // collapsed frame — `isIntersecting: false`, `rootBounds: null`, `innerHeight: 0` — so the
  // guard is defence against the browsers that do report the edge-adjacent case, and this spec
  // is the characterisation that would catch Chromium starting to.)
  const harness = await mountExport(page, {
    body: `<div id="target" class="box vm-a1 vm-in-view">target</div><div class="spacer"></div>`,
    css: CSS,
    embed: true,
    embedHeight: 0,
  });

  await page.waitForTimeout(250);
  expect(await harness.classes("#target")).not.toContain("vm-play");
  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });

  // Given a viewport, it plays like any other in-view element.
  await harness.resizeEmbed(600);

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("a root empty on one axis holds even an element unreachable on the other, and releases it when the root comes back", async ({
  page,
}) => {
  // The case a per-axis guard misses: a root of 640x0 with a 4000x60 track is
  // "unreachable" on the width axis (0.16) and "fully reachable" on the height
  // axis (the empty one answers 1), so the product is under the threshold and
  // the element fires while nothing is visible — once, and then never again,
  // because the export unobserves what it plays. The guard belongs to the
  // root, not to an axis.
  //
  // And a root that comes back is not self-announcing: an unreachable element
  // goes from ratio 0 to a ratio still under the threshold, crossing none of
  // `[0, T]`, so the browser has nothing to report. The script re-observes.
  const harness = await mountExport(page, {
    body:
      `<div id="target" class="vm-a1 vm-in-view" style="width:4000px;height:60px;background:#ddd"></div>` +
      `<div class="spacer"></div>`,
    css: CSS,
    embed: true,
    embedHeight: 0,
  });

  await page.waitForTimeout(250);
  expect(await harness.classes("#target")).not.toContain("vm-play");

  await harness.resizeEmbed(600);

  await expect.poll(async () => await harness.classes("#target")).toContain("vm-play");
  expect(await harness.starts(KEYFRAMES)).toBe(1);
});

test("a page with no doctype still measures the viewport, not the whole document", async ({
  page,
}) => {
  // An export keeps the doctype of the page it was cloned from, and plenty of real pages have
  // none: `document.compatMode` is then `BackCompat`, where `documentElement.clientHeight` is the
  // DOCUMENT box, not the viewport — measured 4400px in a 400px frame. A hero taller than five
  // viewports then looks comfortably reachable (`min(1, 4400 / 2400)` = 1), so the ratio test
  // decides it, it can never reach 0.2 in a viewport it is six times the height of, and the
  // element stays at `opacity: 0` for good.
  //
  // Embedded, because that is when the script has to measure the root itself: `entry.rootBounds`
  // is null only inside a cross-origin iframe, and everywhere else the browser's own root box is
  // used and quirks mode cannot reach the decision.
  const harness = await mountExport(page, {
    body: `<div class="spacer"></div><div id="target" class="vm-a1 vm-in-view" style="height:600vh;background:#ddd"></div>`,
    css: CSS,
    embed: true,
    quirks: true,
  });

  expect(await harness.frame.evaluate(() => document.compatMode)).toBe("BackCompat");
  expect(await harness.animation("#target")).toMatchObject({ state: "paused", time: 0 });

  await harness.frame.evaluate(() => window.scrollTo(0, 1900));

  await expect.poll(async () => (await harness.animation("#target"))?.state).toBe("running");
  expect(await harness.starts(KEYFRAMES)).toBe(1);
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

      // Asynchronously, the way a real observer delivers: a synchronous callback would be caught
      // by the guard around `observe()` instead, and this spec would pass with the callback's own
      // try/catch deleted. The entry has no `boundingClientRect`, so reading it throws.
      observe(): void {
        setTimeout(() => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never), 0);
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

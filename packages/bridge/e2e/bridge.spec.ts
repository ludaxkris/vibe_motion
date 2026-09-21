import { expect, test } from "@playwright/test";

import { FOREIGN_ORIGIN, assignment, mountBridge } from "./harness";

const FADE_IN = "@keyframes vm-iv-v1-0-0 { from { opacity: 0 } to { opacity: 1 } }";

// ---------------------------------------------------------------------------------------------
// 1. in-view (B1)
// ---------------------------------------------------------------------------------------------

test.describe("in-view trigger", () => {
  const body = `
    <div class="box" data-vm-id="vm-top">top</div>
    <div class="spacer"></div>
    <div class="box" data-vm-id="vm-iv">in view</div>
    <div class="spacer"></div>`;

  const inView = assignment("vm-iv", {
    trigger: "in-view",
    keyframesName: "vm-iv-v1-0-0",
    keyframesCss: FADE_IN,
    style: { "animation-duration": "200ms", "animation-fill-mode": "both" },
  });

  test("holds at the first keyframe, plays on entry, and holds again after leaving", async ({ page }) => {
    const h = await mountBridge(page, body);
    const scrollTo = (y: number) => h.frame.evaluate((top) => window.scrollTo(0, top), y);
    const ivTop = await h.frame.evaluate(
      () => document.querySelector('[data-vm-id="vm-iv"]')!.getBoundingClientRect().top + window.scrollY,
    );

    await h.send("apply", inView);

    // Before the first entry: a real animation exists, paused at time zero, showing frame one.
    // A paused animation at t=0 is still in its active phase, so it counts as one start.
    await expect.poll(() => h.animations("vm-iv")).toHaveLength(1);
    expect((await h.animations("vm-iv"))[0]).toMatchObject({ name: "vm-iv-v1-0-0", time: 0, state: "paused" });
    expect(await h.computed("vm-iv", "opacity")).toBe("0");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(1);

    // Entry plays it, as a new animation.
    await scrollTo(ivTop - 200);
    await expect.poll(() => h.computed("vm-iv", "opacity")).toBe("1");
    expect((await h.animations("vm-iv"))[0]).toMatchObject({ state: "finished" });
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(2);

    // Leaving holds it at the FIRST keyframe again, not wherever it finished. This is the half
    // that cannot work by toggling play-state: the finished animation has to be replaced.
    await scrollTo(0);
    await expect.poll(() => h.computed("vm-iv", "opacity")).toBe("0");
    expect((await h.animations("vm-iv"))[0]).toMatchObject({ time: 0, state: "paused" });
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(3);

    // Re-entry plays a genuinely new animation, so the designer can scroll back and watch again.
    await scrollTo(ivTop - 200);
    await expect.poll(() => h.computed("vm-iv", "opacity")).toBe("1");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------
// 1b. in-view reachability (A12 / DT-095 / DT-179)
//
// `intersectionRatio` is an **area** ratio — intersected area over the element's *whole* area — so
// an element much bigger than the root can never reach `IN_VIEW_THRESHOLD` at all, and a rule that
// only tests the ratio holds it on its first keyframe for the whole session. The preview fires on
// the same condition as the export (spec §6a): `isIntersecting && (ratio >= T || reachable <= T)`.
//
// The frame is 800×600 (`e2e/harness.ts`) and is cross-origin with the shell, which is exactly the
// case `entry.rootBounds` comes back **null** for: every number below is against the frame's own
// `window.innerWidth` / `innerHeight`, through the fallback, because in the bridge that is not an
// edge case but the only case.
//
// Not covered here, and logged as DT-184 for preview and export alike: a clip container narrower
// than the root bounds the intersection without appearing in `rootBounds`, so an element that looks
// reachable against the viewport can still be unable to reach `T`.
// ---------------------------------------------------------------------------------------------

test.describe("in-view reachability", () => {
  /** A 200 ms fade, so "it played" is a settled `opacity: 1` rather than a race. */
  const inViewOver = {
    trigger: "in-view" as const,
    keyframesName: "vm-iv-v1-0-0",
    keyframesCss: FADE_IN,
    style: { "animation-duration": "200ms", "animation-fill-mode": "both" },
  };

  const scrollToTarget = (h: Awaited<ReturnType<typeof mountBridge>>, vmId: string) =>
    h.frame.evaluate((id) => document.querySelector(`[data-vm-id="${id}"]`)!.scrollIntoView(), vmId);

  test("plays an element taller than five viewports, whose ratio can never reach the threshold", async ({
    page,
  }) => {
    // 4000px tall in a 600px frame: the most of itself it can ever show is 600/4000 = 0.15. With
    // the ratio test alone this element was held at `opacity: 0` for ever, while the very same
    // element animated in the export.
    const h = await mountBridge(
      page,
      `<div class="spacer"></div>
       <div data-vm-id="vm-tall" style="height:4000px;background:#ddd">tall</div>`,
    );
    await h.send("apply", assignment("vm-tall", inViewOver));

    // Held below the fold: a real animation, paused on its first keyframe. (A paused animation at
    // t=0 is still in its active phase, so it counts as one `animationstart`.)
    await expect.poll(() => h.animations("vm-tall")).toMatchObject([{ time: 0, state: "paused" }]);
    expect(await h.computed("vm-tall", "opacity")).toBe("0");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(1);

    await scrollToTarget(h, "vm-tall");

    await expect.poll(() => h.computed("vm-tall", "opacity")).toBe("1");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(2);
  });

  test("plays a track wider than the frame inside a horizontal scroller", async ({ page }) => {
    // Reachability is an area, not a height: 800/5000 = 0.16 with a perfectly ordinary 60px height,
    // so a height-only rule leaves this one held. The 600px scroller clips it further still, which
    // only makes the real ratio smaller (0.12).
    const h = await mountBridge(
      page,
      `<div class="spacer"></div>
       <div style="overflow-x:auto;width:600px">
         <div data-vm-id="vm-wide" style="width:5000px;height:60px;background:#ddd">wide</div>
       </div>`,
    );
    await h.send("apply", assignment("vm-wide", inViewOver));

    await expect.poll(() => h.animations("vm-wide")).toMatchObject([{ time: 0, state: "paused" }]);
    expect(await h.computed("vm-wide", "opacity")).toBe("0");

    await scrollToTarget(h, "vm-wide");

    await expect.poll(() => h.computed("vm-wide", "opacity")).toBe("1");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(2);
  });

  test("an element that can reach the threshold still waits for it, and not for the first sliver", async ({
    page,
  }) => {
    // The escape hatch must not swallow the ordinary case. This 200×60 box can reach ratio 1, so
    // it stays held at 6px of itself on screen (0.1) and plays at 30px (0.5).
    const h = await mountBridge(
      page,
      `<div class="spacer"></div>
       <div class="box" data-vm-id="vm-iv">in view</div>
       <div class="spacer"></div>`,
    );
    const scrollTo = (y: number) => h.frame.evaluate((top) => window.scrollTo(0, top), y);
    const ivTop = await h.frame.evaluate(
      () => document.querySelector('[data-vm-id="vm-iv"]')!.getBoundingClientRect().top + window.scrollY,
    );
    await h.send("apply", assignment("vm-iv", inViewOver));
    await expect.poll(() => h.animations("vm-iv")).toMatchObject([{ time: 0, state: "paused" }]);

    await scrollTo(ivTop - 594);
    // Long enough for a wrong fire to have played the whole 200 ms animation and shown itself.
    await page.waitForTimeout(400);

    expect(await h.animations("vm-iv")).toMatchObject([{ time: 0, state: "paused" }]);
    expect(await h.computed("vm-iv", "opacity")).toBe("0");
    expect(await h.starts("vm-iv-v1-0-0")).toBe(1);

    await scrollTo(ivTop - 570);

    await expect.poll(() => h.computed("vm-iv", "opacity")).toBe("1");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(2);
  });

  test("re-arms an unreachable element on every entry, the way the preview does for any other", async ({
    page,
  }) => {
    // The one thing the preview does not take from the export: the export unobserves on firing and
    // plays once, the preview holds the element again when it leaves so the designer can scroll
    // back and watch it a second time (spec §6a). For an element this tall "leaves" can only mean
    // `isIntersecting` false — its ratio never crosses the threshold in either direction.
    const h = await mountBridge(
      page,
      `<div class="spacer"></div>
       <div data-vm-id="vm-tall" style="height:4000px;background:#ddd">tall</div>`,
    );
    await h.send("apply", assignment("vm-tall", inViewOver));
    await expect.poll(() => h.animations("vm-tall")).toMatchObject([{ time: 0, state: "paused" }]);

    await scrollToTarget(h, "vm-tall");
    await expect.poll(() => h.computed("vm-tall", "opacity")).toBe("1");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(2);

    // Away again: held at the FIRST keyframe, not left wherever it finished.
    await h.frame.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => h.computed("vm-tall", "opacity")).toBe("0");
    expect(await h.animations("vm-tall")).toMatchObject([{ time: 0, state: "paused" }]);
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(3);

    // And back: a genuinely new animation, as for any other in-view element.
    await scrollToTarget(h, "vm-tall");
    await expect.poll(() => h.computed("vm-tall", "opacity")).toBe("1");
    await expect.poll(() => h.starts("vm-iv-v1-0-0")).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. replay (B2)
// ---------------------------------------------------------------------------------------------

test.describe("replay", () => {
  const spinner = `@keyframes hostspin { to { transform: rotate(360deg) } }`;

  test("restarts the animation from the beginning", async ({ page }) => {
    const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);
    await h.send("apply", assignment("vm-a"));
    await page.waitForTimeout(500);
    expect((await h.animations("vm-a"))[0].time).toBeGreaterThan(200);

    await h.send("replay", { vmId: "vm-a" });

    expect((await h.animations("vm-a"))[0].time).toBeLessThan(100);
  });

  test("a forced replay ends on the element's own animationend", async ({ page }) => {
    const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);
    await h.send("apply", assignment("vm-a", { trigger: "hover", style: { "animation-duration": "300ms" } }));
    expect(await h.inline("vm-a", "animation-name")).toBe("");

    await h.send("replay", { vmId: "vm-a" });
    expect(await h.inline("vm-a", "animation-name")).toBe("vm-fade-v1-0-0");

    await expect.poll(() => h.inline("vm-a", "animation-name"), { timeout: 3000 }).toBe("");
  });

  test("a descendant's own animationend does not end the forced replay", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<div class="box" data-vm-id="vm-card" style="height:120px">
         <span class="inner" style="animation: hostspin 200ms linear; display:inline-block">spin</span>
       </div>`,
      `<style>${spinner}</style>`,
    );
    await h.send("apply", assignment("vm-card", { trigger: "hover", style: { "animation-duration": "3s" } }));

    await h.send("replay", { vmId: "vm-card" });
    expect(await h.inline("vm-card", "animation-name")).toBe("vm-fade-v1-0-0");

    // The child's 200ms host animation ends well before ours.
    await page.waitForTimeout(700);
    expect(await h.inline("vm-card", "animation-name")).toBe("vm-fade-v1-0-0");
  });

  /**
   * `rewind()` writes `animation-name: none` before putting the name back. When the element
   * already had a live animation of that same name, that write *cancels* it, and the
   * `animationcancel` lands a frame later — after the replacement has already started. An
   * end-condition that trusts it kills the replay it was meant to protect.
   */
  test("plays an off-screen in-view element that was held on its first keyframe", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<div class="box" data-vm-id="vm-top">top</div>
       <div class="spacer"></div>
       <div class="box" data-vm-id="vm-iv">in view</div>
       <div class="spacer"></div>`,
    );
    await h.send("apply", assignment("vm-iv", { trigger: "in-view", style: { "animation-duration": "1s" } }));
    // Held: a paused animation of the very name the replay is about to write again.
    await expect.poll(() => h.animations("vm-iv")).toMatchObject([{ time: 0, state: "paused" }]);

    await h.send("replay", { vmId: "vm-iv" });

    // Sampled every frame for most of one duration: it must be running the whole way through,
    // not merely running at whichever instant we happened to look.
    const frames = await h.sample("vm-iv", 600);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.filter((f) => f?.state !== "running")).toEqual([]);
    expect(frames[frames.length - 1]?.time).toBeGreaterThan(400);

    // And when that one play is over it goes back to being held, at the first keyframe.
    await expect
      .poll(() => h.animations("vm-iv"), { timeout: 3000 })
      .toMatchObject([{ time: 0, state: "paused" }]);
  });

  test("replays every element, including one held off-screen, with vmId null", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<div class="box" data-vm-id="vm-top">top</div>
       <div class="spacer"></div>
       <div class="box" data-vm-id="vm-iv">in view</div>
       <div class="spacer"></div>`,
    );
    await h.send("apply", assignment("vm-top"));
    await h.send("apply", assignment("vm-iv", { trigger: "in-view", style: { "animation-duration": "1s" } }));
    await expect.poll(() => h.animations("vm-iv")).toMatchObject([{ time: 0, state: "paused" }]);

    await h.send("replay", { vmId: null });

    const frames = await h.sample("vm-iv", 600);
    expect(frames.filter((f) => f?.state !== "running")).toEqual([]);
    expect(frames[frames.length - 1]?.time).toBeGreaterThan(400);
    expect((await h.animations("vm-top"))[0].state).toBe("running");
  });

  test("does not play a third time when the element arms while the forced replay runs", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<div class="box" data-vm-id="vm-top">top</div>
       <div class="spacer"></div>
       <div class="box" data-vm-id="vm-iv">in view</div>
       <div class="spacer"></div>`,
    );
    const ivTop = await h.frame.evaluate(
      () => document.querySelector('[data-vm-id="vm-iv"]')!.getBoundingClientRect().top + window.scrollY,
    );
    await h.send("apply", assignment("vm-iv", {
      trigger: "in-view",
      style: { "animation-duration": "800ms", "animation-fill-mode": "both" },
    }));
    await expect.poll(() => h.animations("vm-iv")).toMatchObject([{ time: 0, state: "paused" }]);
    const before = await h.starts("vm-fade-v1-0-0");

    // Click Replay on something below the fold, then scroll down to watch it.
    await h.send("replay", { vmId: "vm-iv" });
    await page.waitForTimeout(250);
    await h.frame.evaluate((top) => window.scrollTo(0, top), ivTop - 200);

    // Long enough for the arm play to finish and for a spurious third play to have started.
    await page.waitForTimeout(1600);

    // Exactly two: the forced play, and the `in-view` trigger legitimately arming on the way in.
    expect(await h.starts("vm-fade-v1-0-0")).toBe(before + 2);
    // And it is left armed, not held back at the first keyframe.
    expect((await h.animations("vm-iv"))[0]).toMatchObject({ state: "finished" });
    expect(await h.computed("vm-iv", "animation-play-state")).toBe("running");
  });

  test("survives an apply that lands while the forced replay is running", async ({ page }) => {
    const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);
    const hover = { trigger: "hover" as const, style: { "animation-duration": "3s" } };
    await h.send("apply", assignment("vm-a", hover));

    await h.send("replay", { vmId: "vm-a" });
    expect(await h.animations("vm-a")).toMatchObject([{ name: "vm-fade-v1-0-0", state: "running" }]);

    // The designer keeps editing while the replay runs. A base-styles change restarts the
    // animation under the same name, which is exactly when a cancel we caused ourselves is
    // indistinguishable from the animation really going away.
    await h.send("apply", assignment("vm-a", { ...hover, baseStyles: "transform-origin: top;" }));

    const frames = await h.sample("vm-a", 600);
    expect(frames.filter((f) => f?.name !== "vm-fade-v1-0-0" || f.state !== "running")).toEqual([]);
    expect(frames[frames.length - 1]?.time).toBeGreaterThan(400);
    expect(await h.inline("vm-a", "animation-name")).toBe("vm-fade-v1-0-0");
  });

  test("a forced replay of an infinite animation ends after one iteration", async ({ page }) => {
    const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);
    await h.send("apply", {
      ...assignment("vm-a", { trigger: "hover" }),
      keyframesName: "vm-pulse-v1-0-0",
      keyframesCss: "@keyframes vm-pulse-v1-0-0 { 50% { opacity: .3 } }",
      style: { "animation-duration": "300ms", "animation-iteration-count": "infinite" },
    });

    await h.send("replay", { vmId: "vm-a" });
    expect(await h.inline("vm-a", "animation-name")).toBe("vm-pulse-v1-0-0");

    await expect.poll(() => h.inline("vm-a", "animation-name"), { timeout: 3000 }).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// 3. nested hover (B3)
// ---------------------------------------------------------------------------------------------

test("a hover-armed card stays armed while the pointer is over a tagged child", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div class="box" data-vm-id="vm-card" style="height:160px;padding:20px">
       <button data-vm-id="vm-btn" style="margin:40px">press</button>
     </div>`,
  );
  await h.send("apply", assignment("vm-card", { trigger: "hover" }));

  const points = await h.frame.evaluate(() => {
    const card = document.querySelector('[data-vm-id="vm-card"]')!.getBoundingClientRect();
    const btn = document.querySelector('[data-vm-id="vm-btn"]')!.getBoundingClientRect();
    return {
      card: { x: card.left + 5, y: card.top + 5 },
      btn: { x: btn.left + btn.width / 2, y: btn.top + btn.height / 2 },
    };
  });

  await page.mouse.move(points.card.x, points.card.y);
  await expect.poll(() => h.inline("vm-card", "animation-name")).toBe("vm-fade-v1-0-0");

  await page.mouse.move(points.btn.x, points.btn.y);
  await page.waitForTimeout(200);
  expect(await h.inline("vm-card", "animation-name")).toBe("vm-fade-v1-0-0");

  const hovers = (await h.messages("element:hover")).map((m) => m.payload.vmId);
  expect(hovers).toEqual(["vm-card", "vm-btn"]);

  await page.mouse.move(5, 580);
  await expect.poll(() => h.inline("vm-card", "animation-name")).toBe("");
});

// ---------------------------------------------------------------------------------------------
// 4. host shorthand and the whole animation group (N2)
// ---------------------------------------------------------------------------------------------

test("neither leaks the host's animation longhands in, nor loses them on clear", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div class="box" data-vm-id="vm-spin" style="animation: spin 2s linear infinite">spin</div>`,
    `<style>@keyframes spin { to { transform: rotate(360deg) } }</style>`,
  );
  const longhands = [
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
  ];
  const snapshot = async () => {
    const out: Record<string, string> = {};
    for (const prop of longhands) out[prop] = await h.computed("vm-spin", prop);
    return out;
  };

  const before = await snapshot();
  expect(before["animation-iteration-count"]).toBe("infinite");

  // A style map that carries neither iteration count nor timing function.
  await h.send("apply", assignment("vm-spin", { style: { "animation-duration": "600ms" } }));

  expect(await h.computed("vm-spin", "animation-iteration-count")).toBe("1");
  expect(await h.computed("vm-spin", "animation-timing-function")).toBe("ease");
  expect(await h.computed("vm-spin", "animation-fill-mode")).toBe("none");

  await h.send("clear", { vmId: "vm-spin" });

  expect(await snapshot()).toEqual(before);
});

// ---------------------------------------------------------------------------------------------
// 5. reduced motion
// ---------------------------------------------------------------------------------------------

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the preview still plays through a host prefers-reduced-motion reset", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<div class="box" data-vm-id="vm-a">A</div>`,
      `<style>@media (prefers-reduced-motion: reduce) { * { animation: none !important } }</style>`,
    );

    await h.send("apply", assignment("vm-a"));

    expect(await h.frame.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await expect.poll(() => h.animations("vm-a")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. overlay geometry
// ---------------------------------------------------------------------------------------------

test("the selection ring tracks the element through a nested scroller", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div id="sc" style="height:200px;overflow:auto;border:1px solid #999">
       <div style="height:900px;padding-top:400px">
         <div class="box" data-vm-id="vm-deep">deep</div>
       </div>
     </div>`,
  );

  await h.send("select", { vmId: "vm-deep", label: "div · Fade" });
  const ring = "[data-vm-overlay-ring]";
  await expect.poll(() => h.rect(ring)).toEqual(await h.rect('[data-vm-id="vm-deep"]'));

  await h.frame.evaluate(() => {
    document.getElementById("sc")!.scrollTop = 350;
  });
  await page.waitForTimeout(200);

  expect(await h.rect(ring)).toEqual(await h.rect('[data-vm-id="vm-deep"]'));
  expect(await h.frame.textContent("[data-vm-overlay-label]")).toBe("div · Fade");
});

// ---------------------------------------------------------------------------------------------
// 7. origin negative
// ---------------------------------------------------------------------------------------------

test("a message from a third origin is never acked and never applied", async ({ page }) => {
  const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);

  const evil = page.frames().find((f) => f.url().startsWith(FOREIGN_ORIGIN));
  expect(evil).toBeDefined();
  await evil!.evaluate((payload) => {
    window.__payload = payload;
    window.__attack(9999);
  }, assignment("vm-a"));

  // A legitimate round trip guarantees the attack message has been delivered or dropped by now.
  const ack = await h.send("hello", {});
  expect(ack.ok).toBe(true);

  const acks = (await h.messages("ack")).map((m) => m.payload.seq);
  expect(acks).not.toContain(9999);
  expect(await h.inline("vm-a", "animation-name")).toBe("");
});

// ---------------------------------------------------------------------------------------------
// CSS injection through baseStyles (N1)
// ---------------------------------------------------------------------------------------------

test("base styles cannot escape their own rule", async ({ page }) => {
  const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);

  await h.send("apply", assignment("vm-a", { baseStyles: "color:red } body { display:none } x{" }));

  expect(await h.frame.evaluate(() => getComputedStyle(document.body).display)).not.toBe("none");
});

test("keyframes css that is not exactly one matching @keyframes rule is rejected", async ({ page }) => {
  const h = await mountBridge(page, `<div class="box" data-vm-id="vm-a">A</div>`);

  const wrongName = await h.send("apply", assignment("vm-a", { keyframesCss: "@keyframes vm-other-v1-0-0 { to { opacity: 1 } }" }));
  expect(wrongName).toMatchObject({ ok: false, error: "invalid-payload" });

  const notKeyframes = await h.send("apply", assignment("vm-a", { keyframesCss: "body { display: none }" }));
  expect(notKeyframes).toMatchObject({ ok: false, error: "invalid-payload" });

  // The one that matters: a correct block with a second rule smuggled in behind it.
  const trailing = await h.send(
    "apply",
    assignment("vm-a", {
      keyframesCss: "@keyframes vm-fade-v1-0-0 { to { opacity: 1 } } body { display: none }",
    }),
  );
  expect(trailing).toMatchObject({ ok: false, error: "invalid-payload" });

  expect(await h.frame.evaluate(() => getComputedStyle(document.body).display)).not.toBe("none");
  expect(await h.inline("vm-a", "animation-name")).toBe("");
});

test("the selection ring marks the resting box, not the box mid-animation", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div class="spacer" style="height:80px"></div>
     <div class="box" data-vm-id="vm-1">Headline</div>`,
  );

  const resting = await h.rect('[data-vm-id="vm-1"]');
  await h.send("select", { vmId: "vm-1", label: "div" });
  await h.send(
    "apply",
    assignment("vm-1", {
      keyframesName: "vm-fade-in-up-v1-1-0",
      keyframesCss:
        "@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }",
      style: { "animation-duration": "1200ms", "animation-fill-mode": "both" },
    }),
  );

  // Mid-flight the element really is 24px low…
  await page.waitForTimeout(150);
  const moved = await h.rect('[data-vm-id="vm-1"]');
  expect(moved.y).toBeGreaterThan(resting.y);

  // …and the ring stays on the resting box regardless. Sampled repeatedly:
  // scroll, resize and every message schedule a reposition.
  for (let sample = 0; sample < 4; sample += 1) {
    await h.send("replay", { vmId: "vm-1" });
    await page.waitForTimeout(80);
    const ring = await h.rect("[data-vm-overlay-ring]");
    expect(Math.abs(ring.y - resting.y), `sample ${sample}`).toBeLessThanOrEqual(1);
  }

  // And after it finishes, the ring is still right where the element is.
  await page.waitForTimeout(1400);
  const settled = await h.rect("[data-vm-overlay-ring]");
  expect(Math.abs(settled.y - resting.y)).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------------------------
// 6b. the ring under an animation that never ends
//
// Catalog 1.1.0 ships six entries whose `iteration` default is `infinite` — pulse, heartbeat,
// glow, spin, float and shimmer. None of them ever fires `animationend`, and `animationiteration`
// is deliberately not a resync trigger, so anything the overlay defers "until the animation is
// over" is deferred for as long as the element stays selected. These three cover the resync
// triggers that are not message-driven: the capture-phase `scroll` listener (page and nested
// scroller), the `ResizeObserver` on <html>, and the `resize` listener.
// ---------------------------------------------------------------------------------------------

const RING = "[data-vm-overlay-ring]";

/**
 * `float` crossed with `pulse`, and — unlike either — never passing through the identity
 * transform: every single sample is off the resting box in both axes *and* in size, so a ring
 * that measured the live box could not accidentally pass any assertion below.
 */
function neverResting(vmId: string) {
  return assignment(vmId, {
    keyframesName: "vm-drift-v1-1-0",
    keyframesCss:
      "@keyframes vm-drift-v1-1-0 { from { transform: translate(12px, 20px) scale(1.2) } to { transform: translate(28px, 44px) scale(1.4) } }",
    style: {
      "animation-duration": "900ms",
      "animation-iteration-count": "infinite",
      "animation-timing-function": "linear",
      "animation-fill-mode": "both",
    },
    animationId: "float",
    catalogVersion: "1.1.0",
  });
}

/** Assert the element really is mid-flight and really is never going to stop. */
async function assertAdrift(h: Awaited<ReturnType<typeof mountBridge>>, vmId: string, resting: { y: number; height: number }) {
  expect(await h.animations(vmId)).toMatchObject([{ name: "vm-drift-v1-1-0", state: "running" }]);
  const live = await h.rect(`[data-vm-id="${vmId}"]`);
  expect(live.y, "the element is translated").toBeGreaterThan(resting.y);
  expect(live.height, "and scaled").toBeGreaterThan(resting.height);
}

test("the ring tracks page and nested scrolling while an infinite animation runs", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div class="spacer" style="height:150px"></div>
     <div id="sc" style="height:220px;overflow:auto;border:1px solid #999">
       <div style="height:1200px;padding-top:300px">
         <div class="box" data-vm-id="vm-deep">deep</div>
       </div>
     </div>
     <div class="spacer"></div>`,
  );

  const resting = await h.rect('[data-vm-id="vm-deep"]');
  await h.send("select", { vmId: "vm-deep", label: "div" });
  await h.send("apply", neverResting("vm-deep"));
  await page.waitForTimeout(120);
  await assertAdrift(h, "vm-deep", resting);

  // Before anything scrolls the ring is on the resting box, not on the live one.
  await expect.poll(() => h.rect(RING)).toEqual(resting);

  // The page scrolls…
  let pageY = 0;
  for (const by of [180, 260, -90]) {
    await h.frame.evaluate((n) => window.scrollBy(0, n), by);
    pageY = await h.frame.evaluate(() => Math.round(window.scrollY));
    await expect
      .poll(() => h.rect(RING), { timeout: 2_000, message: `page scrolled to ${pageY}` })
      .toEqual({ ...resting, y: resting.y - pageY });
  }
  expect(pageY, "the page really scrolled").toBeGreaterThan(0);

  // …and so does a scroller inside it, which only the capture-phase listener hears.
  for (const top of [120, 420, 40]) {
    await h.frame.evaluate((n) => {
      document.getElementById("sc")!.scrollTop = n;
    }, top);
    await expect
      .poll(() => h.rect(RING), { timeout: 2_000, message: `#sc scrolled to ${top}` })
      .toEqual({ ...resting, y: resting.y - pageY - top });
  }

  // It never ended, and the ring never once showed the live box.
  await assertAdrift(h, "vm-deep", { y: resting.y - pageY - 40, height: resting.height });
});

test("an <svg> has no offset box: its ring stays visible and tracks scroll, selected before or during a spin", async ({ page }) => {
  // The clone pipeline gives `<svg>` a data-vm-id (it is an opaque, selectable target), and a
  // spinning logo is the canonical use. SVGSVGElement is not an HTMLElement: offsetLeft/Top/
  // Width/Height/offsetParent are all undefined, so the layout-box path cannot serve it. The
  // ring falls back to the live bounding box: it follows the spin's box, but it is never empty
  // and never frozen.
  const h = await mountBridge(
    page,
    `<div class="spacer" style="height:200px"></div>
     <svg data-vm-id="vm-logo" width="180" height="90" viewBox="0 0 180 90" style="display:block">
       <rect width="180" height="90" fill="#7c5cff"></rect>
     </svg>
     <div class="spacer"></div>`,
  );
  const spin = assignment("vm-logo", {
    keyframesName: "vm-spin-v1-1-0",
    keyframesCss: "@keyframes vm-spin-v1-1-0 { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }",
    style: {
      "animation-duration": "4000ms",
      "animation-iteration-count": "infinite",
      "animation-timing-function": "linear",
    },
    animationId: "spin",
    catalogVersion: "1.1.0",
  });

  // Selected first, then animated, then scrolled: the ring must move with the page.
  await h.send("select", { vmId: "vm-logo", label: "svg" });
  await h.send("apply", spin);
  await page.waitForTimeout(150);
  expect(await h.animations("vm-logo")).toMatchObject([{ name: "vm-spin-v1-1-0", state: "running" }]);
  const before = await h.rect(RING);
  expect(before.width, "the ring is not empty").toBeGreaterThan(0);
  await h.frame.evaluate(() => window.scrollBy(0, 120));
  await expect
    .poll(async () => {
      const ring = await h.rect(RING);
      const live = await h.rect('[data-vm-id="vm-logo"]');
      return Math.abs(ring.y - live.y) < 12 && ring.width > 0 && ring.y < before.y - 60;
    }, { timeout: 2_000, message: "ring follows the svg after a scroll" })
    .toBe(true);

  // Selected while it is ALREADY spinning: the ring appears on the element, not at 0,0 size 0.
  await h.send("select", { vmId: null });
  await h.send("select", { vmId: "vm-logo", label: "svg" });
  await expect
    .poll(async () => {
      const ring = await h.rect(RING);
      const live = await h.rect('[data-vm-id="vm-logo"]');
      return ring.width > 0 && ring.height > 0 && Math.abs(ring.y - live.y) < 12 && Math.abs(ring.x - live.x) < 12;
    }, { timeout: 2_000, message: "ring sits on the spinning svg" })
    .toBe(true);
});

test("the ring follows a reflow above it and a viewport resize while an infinite animation runs", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div id="above"></div>
     <div style="display:flex;justify-content:flex-end">
       <div class="box" data-vm-id="vm-1">drift</div>
     </div>`,
  );

  const resting = await h.rect('[data-vm-id="vm-1"]');
  await h.send("select", { vmId: "vm-1", label: "div" });
  await h.send("apply", neverResting("vm-1"));
  await page.waitForTimeout(120);
  await assertAdrift(h, "vm-1", resting);
  await expect.poll(() => h.rect(RING)).toEqual(resting);

  // A late image, font or ad lands above the element. Nothing is scrolled, nothing is resized and
  // no message arrives: the ResizeObserver on <html> is the only thing that hears this.
  await h.frame.evaluate(() => {
    document.getElementById("above")!.style.height = "140px";
  });
  await expect
    .poll(() => h.rect(RING), { timeout: 2_000, message: "after a 140px reflow above the element" })
    .toEqual({ ...resting, y: resting.y + 140 });

  // And the viewport changes, which in this layout moves the element horizontally.
  await page.evaluate(() => {
    document.getElementById("f")!.style.width = "500px";
  });
  await expect
    .poll(() => h.rect(RING), { timeout: 2_000, message: "after narrowing the frame by 300px" })
    .toEqual({ ...resting, x: resting.x - 300, y: resting.y + 140 });

  await assertAdrift(h, "vm-1", { y: resting.y + 140, height: resting.height });
});

test("a finite animation's ring still marks the resting box, and tracks a scroll through it", async ({ page }) => {
  const h = await mountBridge(
    page,
    `<div class="spacer" style="height:80px"></div>
     <div class="box" data-vm-id="vm-1">Headline</div>
     <div class="spacer"></div>`,
  );

  const resting = await h.rect('[data-vm-id="vm-1"]');
  await h.send("select", { vmId: "vm-1", label: "div" });
  await h.send(
    "apply",
    assignment("vm-1", {
      keyframesName: "vm-fade-in-up-v1-1-0",
      keyframesCss:
        "@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }",
      // Long enough that the assertions below are comfortably inside the play even on a slow CI
      // box; the ring is expected to settle within a frame or two, not within the duration.
      style: { "animation-duration": "4000ms", "animation-timing-function": "linear", "animation-fill-mode": "both" },
    }),
  );

  await page.waitForTimeout(150);
  expect((await h.rect('[data-vm-id="vm-1"]')).y, "mid-flight the element is 24px low").toBeGreaterThan(resting.y);

  // The resting box, through the scroll, *while* it plays — the ring must move by the scroll and
  // by nothing else.
  await h.frame.evaluate(() => window.scrollBy(0, 200));
  const scrolled = await h.frame.evaluate(() => Math.round(window.scrollY));
  expect(scrolled).toBe(200);
  await expect.poll(() => h.rect(RING), { timeout: 2_000 }).toEqual({ ...resting, y: resting.y - scrolled });
  expect((await h.animations("vm-1"))[0], "still playing").toMatchObject({ state: "running" });

  // And once it has finished, still there.
  await expect.poll(() => h.animations("vm-1").then((a) => a[0]?.state), { timeout: 8_000 }).toBe("finished");
  expect(await h.rect(RING)).toEqual({ ...resting, y: resting.y - scrolled });
});

// ---------------------------------------------------------------------------------------------
// elements:query -> elements:list (Phase 5, bridge 1.1.0)
// ---------------------------------------------------------------------------------------------

type ListedElement = {
  vmId: string;
  tag: string;
  role: string | null;
  order: number;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
  pageRect: { x: number; y: number; width: number; height: number };
};
type ElementsList = {
  seq: number;
  elements: ListedElement[];
  truncated: boolean;
  viewport: { width: number; height: number };
};

/** The filter the Phase 5 shell always sends (plan D4 / D6). */
const PHASE_5_FILTER = {
  tags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "img", "picture", "video", "figure", "article", "button", "a"],
  minWidth: 40,
  minHeight: 40,
};

test.describe("elements:query", () => {
  test("lists measured, visible elements in document order, with the frame's viewport", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<h1 class="box" data-vm-id="vm-title">Title</h1>
       <div class="box" data-vm-id="vm-gone" style="display:none">gone</div>
       <div class="box" data-vm-id="vm-ghost" style="visibility:hidden">ghost</div>
       <span data-vm-id="vm-tiny" style="display:inline-block;width:10px;height:10px"></span>
       <div class="box" data-vm-id="vm-card"><p data-vm-id="vm-copy" style="margin:0;height:50px">Copy</p></div>
       <div class="spacer"></div>
       <div class="box" data-vm-id="vm-below" role="button">below the fold</div>`,
    );

    const ack = await h.send("elements:query", { filter: { minWidth: 40, minHeight: 40 } });
    expect(ack.ok).toBe(true);

    const all = await h.messages();
    const lists = all.filter((m) => m.type === "elements:list");
    expect(lists).toHaveLength(1);
    const list = lists[0].payload as unknown as ElementsList;

    // The list lands before its ack, and carries the ack's seq.
    const listAt = all.findIndex((m) => m.type === "elements:list");
    const ackAt = all.findIndex((m) => m.type === "ack" && m.payload.seq === ack.seq);
    expect(listAt).toBeLessThan(ackAt);
    expect(list.seq).toBe(ack.seq);

    expect(list.elements.map((e) => e.vmId)).toEqual(["vm-title", "vm-card", "vm-copy", "vm-below"]);
    expect(list.truncated).toBe(false);
    // The harness iframe is 800x600.
    expect(list.viewport).toEqual({ width: 800, height: 600 });

    const orders = list.elements.map((e) => e.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const e of list.elements) {
      expect(e.visible).toBe(true);
      expect(e.pageRect.width).toBeGreaterThanOrEqual(40);
      expect(e.pageRect.height).toBeGreaterThanOrEqual(40);
    }
    const ys = list.elements.map((e) => e.pageRect.y);
    expect(ys[0]).toBeGreaterThan(0);
    expect(ys[3]).toBeGreaterThan(list.viewport.height); // below the fold: what `viewport` is for
    expect(await h.rect('[data-vm-id="vm-title"]')).toMatchObject({
      width: Math.round(list.elements[0].rect.width),
      height: Math.round(list.elements[0].rect.height),
    });
  });

  test("pageRect is scroll-independent", async ({ page }) => {
    const h = await mountBridge(
      page,
      `<div class="spacer"></div><h2 class="box" data-vm-id="vm-deep">deep</h2><div class="spacer"></div>`,
    );
    await h.send("elements:query", { filter: { tags: ["h2"] } });
    await h.frame.evaluate(() => window.scrollTo(0, 1500));
    await h.send("elements:query", { filter: { tags: ["h2"] } });

    const [before, after] = (await h.messages("elements:list")).map(
      (m) => (m.payload as unknown as ElementsList).elements[0],
    );
    expect(after.pageRect).toEqual(before.pageRect);
    expect(after.rect.y).toBe(before.rect.y - 1500);
  });

  test("answers the Phase 5 query on a 2,000-element page inside the 50 ms budget (p95), with no writes", async ({ page }) => {
    // What a clone looks like: every element under <body> tagged, targets buried in wrappers.
    // The copy sits inside <article> wrappers, one around the whole page and one per section:
    // `article` is in the Phase 5 filter and `elementInfo` reads a matched element's whole
    // subtree `textContent`, so this is the worst case that filter permits.
    const sentence = "The quick brown fox jumps over the lazy dog while the designer tunes an easing curve. ";
    const paragraph = sentence.repeat(11); // ~950 chars
    let n = 0;
    const id = () => `data-vm-id="vm-e${(n += 1)}"`;
    let sections = "";
    for (let s = 0; s < 40; s += 1) {
      let items = "";
      for (let i = 0; i < 10; i += 1) {
        items += `<li ${id()} style="min-height:44px"><span ${id()}>Item ${i}</span> <a ${id()} href="#" style="display:inline-block;padding:14px 20px">Link ${s}-${i}</a></li>`;
      }
      let paras = "";
      for (let p = 0; p < 8; p += 1) paras += `<div ${id()}><p ${id()}>${paragraph}</p></div>`;
      sections += `<article ${id()}><div ${id()}><div ${id()}>
        <h2 ${id()} style="min-height:44px">Section ${s}</h2>
        <ul ${id()}>${items}</ul>
        ${paras}
        <button ${id()} style="width:120px;height:44px">Go</button>
        <div ${id()} role="button" style="width:120px;height:44px">Also go</div>
      </div></div></article>`;
    }
    const body = `<article ${id()}>${sections}</article>`;
    expect(n).toBeGreaterThanOrEqual(2000);
    expect(body.length).toBeGreaterThanOrEqual(300_000);

    // Installed from <head>, so before the (deferred) bridge script registers its own `message`
    // listener: listeners on the same target run in registration order, so this one runs first,
    // in the SAME event dispatch as the bridge's handler. When `__dirty` is set it invalidates
    // the whole page's layout in the very task that answers the query. No frame can be rendered,
    // and so no layout flushed, between the write and the measurement: every dirty sample pays
    // for the one layout pass a query is allowed to cost. (A write made from a separate
    // Playwright round trip only costs the query a layout when no frame happens to land first.)
    // The MutationObserver sees any DOM or inline-style write; the test's own write is dropped
    // from its count on the spot.
    const head = `<script>
      window.__mutations = 0; window.__dirty = false; window.__dirtied = 0;
      (function () {
        var observer = new MutationObserver(function (records) { window.__mutations += records.length; });
        window.__resetMutations = function () { observer.takeRecords(); window.__mutations = 0; };
        observer.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
        var step = 0;
        window.addEventListener("message", function (event) {
          if (!window.__dirty || !event.data || event.data.type !== "elements:query") return;
          // A width the page has never had, far from the last one, so the lines re-break and
          // no cached layout result can be reused.
          step += 1;
          document.body.style.width = (500 + ((step * 37) % 281)) + "px";
          observer.takeRecords();
          window.__dirtied += 1;
        });
      })();
    </script>`;

    const h = await mountBridge(page, body, head);
    const ready = (await h.messages("ready"))[0].payload;
    expect(ready.elementCount).toBe(n);
    // `elements:query` shipped in 1.1.0; the patch digit moves with every bridge release, so this
    // is the numeric ">= 1.1.0" compare the README tells consumers to do, not a string equality.
    const [major, minor] = String(ready.bridgeVersion).split(".").map(Number);
    expect(major > 1 || (major === 1 && minor >= 1), `bridgeVersion ${ready.bridgeVersion}`).toBe(true);
    // Parsing the page and the bridge's own start-up (overlay, runtime sheet) are not the query's.
    await h.frame.evaluate(() => (window as unknown as { __resetMutations: () => void }).__resetMutations());

    const setDirty = (on: boolean) =>
      h.frame.evaluate((value) => {
        (window as unknown as { __dirty: boolean }).__dirty = value;
      }, on);

    const RUNS = 40;
    const measure = async (payload: unknown) => {
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i += 1) samples.push((await h.send("elements:query", payload)).ms);
      return samples;
    };
    const p95 = (samples: number[]) => [...samples].sort((x, y) => x - y)[Math.ceil(samples.length * 0.95) - 1];
    const describeSamples = (label: string, samples: number[]) => {
      const sorted = [...samples].sort((x, y) => x - y);
      const line = `elements:query ack.ms, ${n} elements, ${label}: median=${sorted[Math.floor(RUNS / 2)].toFixed(1)} p95=${p95(samples).toFixed(1)} max=${sorted[RUNS - 1].toFixed(1)}`;
      test.info().annotations.push({ type: "perf", description: line });
      console.log(line);
      if (process.env.VM_PERF_RAW) console.log(samples.map((x) => x.toFixed(1)).join(" "));
    };

    // What the shell sends; then the most a tag-filtered query can cost: the ceiling limit, which
    // walks further down the page, and sizes nothing reaches, so every element is scanned.
    const scenarios: Array<[string, unknown]> = [
      ["limit 200", { filter: PHASE_5_FILTER, limit: 200 }],
      ["limit 500", { filter: PHASE_5_FILTER, limit: 500 }],
      ["full scan (nothing wide enough)", { filter: { ...PHASE_5_FILTER, minWidth: 5000 } }],
    ];
    const results: Array<[string, number[]]> = [];
    for (const [label, payload] of scenarios) {
      await setDirty(false);
      results.push([`${label}, clean layout`, await measure(payload)]);
      await setDirty(true);
      results.push([`${label}, dirty layout`, await measure(payload)]);
    }
    await setDirty(false);
    for (const [label, samples] of results) describeSamples(label, samples);

    // The dirtying really ran once per dirty sample, and nothing else wrote anything.
    expect(await h.frame.evaluate(() => (window as unknown as { __dirtied: number }).__dirtied)).toBe(RUNS * scenarios.length);
    expect(await h.frame.evaluate(() => (window as unknown as { __mutations: number }).__mutations)).toBe(0);

    const list = (await h.messages("elements:list"))[0].payload as unknown as ElementsList;
    expect(list.elements).toHaveLength(200);
    expect(list.truncated).toBe(true);
    for (const e of list.elements) {
      const roleButton = e.tag === "div" && (e.role ?? "").split(/\s+/).includes("button");
      expect(PHASE_5_FILTER.tags.includes(e.tag) || roleButton, `${e.vmId} <${e.tag} role=${e.role}>`).toBe(true);
    }
    expect(list.elements.some((e) => e.tag === "h2")).toBe(true);
    expect(list.elements.some((e) => e.tag === "article")).toBe(true);
    expect(list.elements.some((e) => e.tag === "div" && e.role === "button")).toBe(true);

    // p95, not max, for the reason spec §6 gives for the slider budget: CI is noisy.
    for (const [label, samples] of results) expect(p95(samples), label).toBeLessThan(50);
  });
});

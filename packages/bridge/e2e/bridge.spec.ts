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

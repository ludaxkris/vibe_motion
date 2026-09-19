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
    expect(ready.bridgeVersion).toBe("1.1.0");
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

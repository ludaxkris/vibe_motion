import { expect, test, type Frame, type Page } from "@playwright/test";

/**
 * The frame-time budget of `docs/plans/phase-4-bridge-protocol.md` §6.
 *
 * Two kinds of assertion, because they answer to different hardware:
 *
 * - **Cost facts** — what the bridge actually does per message, counted inside
 *   the frame. One inline `setProperty` for a param change, no stylesheet
 *   write, no layout read; one `insertRule` per distinct keyframes body for a
 *   `state:load`; one `apply` per vmId per animation frame from the shell.
 *   Deterministic, so they are asserted **everywhere**. These are what actually
 *   guard the budget: a regression that breaks one of them is the reason a
 *   millisecond number would move.
 * - **Wall clock** — the millisecond budgets themselves, under CDP 4x CPU
 *   throttling. A shared CI runner measured 97-172 ms for the end-to-end figure
 *   and 4.3 ms for `ack.ms` on hardware nobody controls, so a wall-clock
 *   threshold there gates on the runner's mood rather than on this code. §6
 *   defines the budgets on a developer-class machine, and the local gate is
 *   where they are asserted; CI prints and annotates exactly the same numbers
 *   without asserting them, so a regression is still visible in the run log.
 *
 * The wall-clock tests run in their own Playwright project (`perf` in
 * `playwright.config.ts`), after every other spec and one at a time: five other
 * Chromium instances competing for the same 4x-throttled CPU measure the
 * machine, not the editor.
 *
 * Driven through `window.__vmTest`, which `lib/bridge/use-bridge.ts` installs
 * only when `NEXT_PUBLIC_API_MOCKING` is on — a production build forces that
 * off (`lib/env.ts`), so the seam cannot exist in a deployed app. That is also
 * why this is a mocked spec and not a stack one.
 */

const VM_ID = "vm-heading";
/** Thrown away before measuring: the first ticks pay for JIT and first paint. */
const WARMUP_TICKS = 20;
const MEASURED_TICKS = 120;

/** Spec §6: the shell-side round trip, store set to ack, end to end. */
const END_TO_END_P95_MS = 16;
/** The bridge and channel alone, as a diagnostic: the same frame, with room. */
const CHANNEL_P95_MS = 16;
/** Spec §6, as amended: the bridge's own handler time, reported from inside the frame. */
const ACK_P95_MS = 4;
/** Sanity bound on the same series — one preempted handler is not a regression. */
const ACK_MAX_MS = 8;
/** Spec §6. */
const STATE_LOAD_ACK_MAX_MS = 50;

const isCI = Boolean(process.env.CI);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarise(values: number[]) {
  if (values.length === 0) return { n: 0 };
  return {
    n: values.length,
    p50: Number(percentile(values, 50).toFixed(2)),
    p95: Number(percentile(values, 95).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
  };
}

/** Both on the run's report and on stdout: the numbers are the point of this spec. */
function report(name: string, value: unknown) {
  const line = JSON.stringify(value);
  test.info().annotations.push({ type: name, description: line });
  console.log(`${name}: ${line}`);
}

/**
 * Assert a wall-clock budget, or — on a shared CI runner — record it and move
 * on. The number is printed either way.
 */
function budget(name: string, measured: number, ceiling: number) {
  report(`${name} (ms, 4x CPU)`, { measured: Number(measured.toFixed(2)), ceiling, asserted: !isCI });
  if (!isCI) expect(measured, `${name} against the §6 budget`).toBeLessThan(ceiling);
}

// ---------------------------------------------------------------------------
// Counting what the bridge does, from inside the frame
// ---------------------------------------------------------------------------

type FrameProbe = {
  /** Inline writes: `element.style.setProperty`. */
  setProperty: number;
  /** Which properties, so a failure says what was written. */
  properties: string[];
  insertRule: number;
  deleteRule: number;
  /** Layout reads. */
  rects: number;
  computed: number;
  /** Envelope types the frame received, in order. */
  received: string[];
};

/**
 * Wrap the four things §6 makes claims about, before any page script runs, and
 * snapshot the counters around the bridge's message handler.
 *
 * The bracketing is what makes this exact. `addInitScript` runs first, so the
 * listener it installs is registered before the bridge's and sees every message
 * first; a second listener added after the bridge is installed therefore runs
 * last. The bridge posts its `ack` synchronously at the end of its handler, so
 * the delta between the two is the handler's whole cost — and the overlay's
 * `requestAnimationFrame` reposition, which §4 budgets separately, is correctly
 * outside it.
 *
 * Two things this must *not* do. `addInitScript` runs in every frame, the shell
 * included, so the guard below keeps the monkey-patches out of the shell, where
 * React would be paying for them and no claim is being counted. And this is
 * installed only by the cost-fact tests (`openInstrumentedEditor`): §6's
 * millisecond budgets are defined for the editor, not for the editor plus five
 * patched DOM methods on both sides of the round trip, so the wall-clock tests
 * open the editor with `openEditor` and measure an uninstrumented page.
 */
async function installFrameProbe(page: Page) {
  await page.addInitScript(() => {
    // The preview frame only. Everything counted here is a claim about what the
    // *bridge* does per message.
    if (window.parent === window) return;

    const probe = {
      setProperty: 0,
      properties: [] as string[],
      insertRule: 0,
      deleteRule: 0,
      rects: 0,
      computed: 0,
      received: [] as string[],
    };
    (window as unknown as { __vmProbe: typeof probe }).__vmProbe = probe;

    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      probe.setProperty += 1;
      probe.properties.push(name);
      return setProperty.call(this, name, value, priority);
    };

    const insertRule = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function (rule, index) {
      probe.insertRule += 1;
      return insertRule.call(this, rule, index);
    };

    const deleteRule = CSSStyleSheet.prototype.deleteRule;
    CSSStyleSheet.prototype.deleteRule = function (index) {
      probe.deleteRule += 1;
      return deleteRule.call(this, index);
    };

    const getBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      probe.rects += 1;
      return getBoundingClientRect.call(this);
    };

    const getComputedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      probe.computed += 1;
      return getComputedStyle(element, pseudo);
    }) as typeof window.getComputedStyle;

    // Arrays copied, not shared: `{ ...probe }` would hand both snapshots the
    // *same* array, and every delta computed from them would be empty.
    const snapshot = () => ({
      ...probe,
      properties: probe.properties.slice(),
      received: probe.received.slice(),
    });
    (window as unknown as { __vmProbeSnapshot: typeof snapshot }).__vmProbeSnapshot = snapshot;

    // First listener in, so it runs before the bridge's on every message.
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source !== "vibe-motion" || typeof data.type !== "string") return;
      probe.received.push(data.type);
      (window as unknown as { __vmProbeBefore: typeof probe }).__vmProbeBefore = snapshot();
    });
  });
}

/** Adds the closing listener, which therefore runs after the bridge's handler. */
async function armFrameProbe(frame: Frame) {
  await frame.evaluate(() => {
    const w = window as unknown as {
      __vmProbeSnapshot: () => Record<string, unknown>;
      __vmProbeAfter?: Record<string, unknown>;
    };
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string } | null;
      if (data?.source !== "vibe-motion") return;
      w.__vmProbeAfter = w.__vmProbeSnapshot();
    });
  });
}

/** What the bridge did inside the handler for the message it last received. */
async function lastHandlerCost(frame: Frame): Promise<FrameProbe> {
  return frame.evaluate(() => {
    const w = window as unknown as {
      __vmProbeBefore: FrameProbeShape;
      __vmProbeAfter: FrameProbeShape;
    };
    const before = w.__vmProbeBefore;
    const after = w.__vmProbeAfter;
    return {
      setProperty: after.setProperty - before.setProperty,
      properties: after.properties.slice(before.properties.length),
      insertRule: after.insertRule - before.insertRule,
      deleteRule: after.deleteRule - before.deleteRule,
      rects: after.rects - before.rects,
      computed: after.computed - before.computed,
      received: after.received.slice(before.received.length - 1),
    };
    type FrameProbeShape = {
      setProperty: number;
      properties: string[];
      insertRule: number;
      deleteRule: number;
      rects: number;
      computed: number;
      received: string[];
    };
  });
}

/** Every envelope type the frame has received so far. Needs the frame probe. */
function receivedTypes(frame: Frame): Promise<string[]> {
  return frame.evaluate(
    () => (window as unknown as { __vmProbe: { received: string[] } }).__vmProbe.received.slice(),
  );
}

// ---------------------------------------------------------------------------

/** Every `ack.ms` the frame reports from now on. */
async function collectAcks(page: Page) {
  await page.evaluate(() => {
    window.__vmAcks = [];
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string; payload?: { ms?: number } };
      if (data?.source !== "vibe-motion" || data.type !== "ack") return;
      if (typeof data.payload?.ms === "number") window.__vmAcks.push(data.payload.ms);
    });
  });
}

function previewFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((candidate) => candidate.url().includes("/mock-api/projects/"));
  if (!frame) throw new Error("the preview frame never loaded");
  return frame;
}

/** Clone the fixture and wait for the handshake. Nothing is instrumented. */
async function openEditor(page: Page) {
  await page.goto("/");
  await page.getByLabel("Page URL").fill("https://example.com");
  await page.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/p\/.+/);
  await page.waitForFunction(() => window.__vmTest?.client.status() === "ready");
  return previewFrame(page);
}

/** The same, with the frame probe — for the cost-fact tests only. */
async function openInstrumentedEditor(page: Page) {
  await installFrameProbe(page);
  const frame = await openEditor(page);
  await armFrameProbe(frame);
  return frame;
}

async function applyFadeInUp(page: Page, vmId = VM_ID) {
  await page.evaluate((id) => {
    const store = window.__vmTest!.store.getState();
    store.setSelectedVmId(id);
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
  }, vmId);
  await page.evaluate(() => window.__vmTest!.client.whenIdle());
}

async function throttle(page: Page, rate: number) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
  return session;
}

// ---------------------------------------------------------------------------
// Cost facts — asserted in every environment
// ---------------------------------------------------------------------------

test("a param change costs one inline write, no stylesheet edit and no layout read", async ({
  page,
}) => {
  const frame = await openInstrumentedEditor(page);
  await applyFadeInUp(page);

  await page.evaluate(() => {
    window.__vmTest!.store.getState().updateDraftParam("vm-heading", "duration", "1234ms");
    return window.__vmTest!.client.whenIdle();
  });

  const cost = await lastHandlerCost(frame);

  expect(cost.received).toEqual(["apply"]);
  // Spec §6: "inline setProperty calls only, no stylesheet write, no layout
  // read". Only the one property that moved is rewritten — `setOwned` skips a
  // declaration that is already exactly what it would write.
  expect(cost.properties).toEqual(["animation-duration"]);
  expect(cost.setProperty).toBe(1);
  expect(cost.insertRule).toBe(0);
  expect(cost.deleteRule).toBe(0);
  expect(cost.rects).toBe(0);
  expect(cost.computed).toBe(0);
});

test("state:load inserts one rule per distinct keyframes body and reads no layout", async ({
  page,
}) => {
  const frame = await openInstrumentedEditor(page);

  // A page big enough to hold them, and four distinct animations so "one rule
  // per distinct keyframes name" is a claim rather than a coincidence.
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Cloned page preview"]',
    );
    if (!iframe) throw new Error("no preview iframe");
    iframe.src = `${iframe.src}?vmExtraElements=200`;
  });
  await expect(
    page.frameLocator('iframe[title="Cloned page preview"]').locator('[data-vm-id="vm-extra-200"]'),
  ).toBeAttached();
  const reloaded = previewFrame(page);
  // The reload re-handshakes, and `ready` makes the client re-send
  // `state:load` *and* `select`. Wait for that pair to land: the probe reads
  // the frame's last handled message, so anything still in flight would be
  // measured instead of the `state:load` under test.
  await expect.poll(() => receivedTypes(reloaded)).toContain("select");
  await armFrameProbe(reloaded);

  // All four exist in catalog 1.1.0 and none of them carries `baseStyles`: a
  // base-styles rule is one per *element* by design (spec §4), so mixing one
  // in would measure that instead of the keyframes reference count. An id that
  // did not resolve would be silently dropped by `toApplied`, so the assertion
  // below checks the frame really got all four.
  const animations = ["fade-in-up", "fade-in", "fade-in-down", "slide-in-up"];
  await page.evaluate((ids) => {
    const { store, client } = window.__vmTest!;
    const draftState: Record<string, unknown> = {};
    for (let index = 1; index <= 200; index += 1) {
      draftState[`vm-extra-${index}`] = {
        animationId: ids[index % ids.length],
        catalogVersion: "1.1.0",
        trigger: "load",
        params: { duration: `${400 + index}ms` },
      };
    }
    store.setState({ draftState });
    return client.whenIdle();
  }, animations);

  const cost = await lastHandlerCost(reloaded);

  expect(cost.received).toEqual(["state:load"]);
  // Every one of the four resolved and reached the frame…
  const names = await reloaded.evaluate(
    () =>
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>('[data-vm-id^="vm-extra-"]'))
          .map((el) => el.style.animationName)
          .filter(Boolean),
      ).size,
  );
  expect(names).toBe(animations.length);
  // …and one `@keyframes` body per distinct name, reference-counted (spec §4),
  // not one per assignment.
  expect(cost.insertRule).toBe(animations.length);
  expect(cost.deleteRule).toBe(0);
  expect(cost.rects).toBe(0);
  expect(cost.computed).toBe(0);
});

test("the shell coalesces a frame's worth of param writes into one apply per element", async ({
  page,
}) => {
  const frame = await openInstrumentedEditor(page);
  await applyFadeInUp(page);
  const before = (await receivedTypes(frame)).length;

  await page.evaluate(() => {
    const { store, client } = window.__vmTest!;
    // Five writes in one task, the way a drag produces them between frames.
    for (let tick = 0; tick < 5; tick += 1) {
      store.getState().updateDraftParam("vm-heading", "duration", `${700 + tick}ms`);
    }
    return client.whenIdle();
  });

  const after = await receivedTypes(frame);
  expect(after.slice(before)).toEqual(["apply"]);
  // …and the frame ends up on the last value, not an intermediate one.
  const applied = await frame.evaluate(
    () =>
      document.querySelector<HTMLElement>('[data-vm-id="vm-heading"]')?.style.animationDuration ??
      "",
  );
  expect(applied).toBe("704ms");
});

// ---------------------------------------------------------------------------
// Wall clock — asserted locally, reported on CI
// ---------------------------------------------------------------------------

test("a param change round-trips inside one frame, and the bridge's handler well inside it", async ({
  page,
}) => {
  await openEditor(page);
  await applyFadeInUp(page);

  await collectAcks(page);
  const session = await throttle(page, 4);

  const measured = await page.evaluate(
    async ({ vmId, warmup, measured }) => {
      const { store, client } = window.__vmTest!;
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

      /** One rAF-paced param change, store set to ack: what the shell observes. */
      const paramTick = async (tick: number) => {
        await nextFrame();
        const started = performance.now();
        store.getState().updateDraftParam(vmId, "duration", `${300 + (tick % 400)}ms`);
        // `whenIdle` flushes the frame the change scheduled, then waits for
        // its ack.
        await client.whenIdle();
        return performance.now() - started;
      };

      /**
       * The same size of payload over the same channel, with no store write
       * and so no React render between the post and the ack. `preview` is if
       * anything pessimistic: the bridge forces a style flush for it, which an
       * `apply` of a param does not.
       */
      const channelTick = async () => {
        const assignment = store.getState().draftState[vmId];
        await nextFrame();
        const started = performance.now();
        client.preview(vmId, assignment);
        await client.whenIdle();
        return performance.now() - started;
      };

      // Warm-up: JIT, first paint, the first style resolutions. Measured by
      // nobody — and the ack buffer is emptied afterwards, so no warm-up tick
      // can reach a statistic.
      for (let tick = 0; tick < warmup; tick += 1) {
        await paramTick(tick);
        await channelTick();
      }

      // The warm-up's last `channelTick` left a preview up, and the client
      // ends an active preview before an `apply` that would land under it
      // (spec §5) — which would put a second ack, and a second message, inside
      // the first measured tick. End it deliberately instead.
      client.clearPreview();
      await client.whenIdle();

      // The two paths are measured in separate phases so that their acks do
      // not mix: §6's `ack.ms` budget is the *param change* one, and a
      // preview's ack is a different, heavier handler.
      window.__vmAcks = [];
      const endToEnd: number[] = [];
      for (let tick = 0; tick < measured; tick += 1) endToEnd.push(await paramTick(tick));
      const applyAcks = window.__vmAcks.slice();

      window.__vmAcks = [];
      const channel: number[] = [];
      for (let tick = 0; tick < measured; tick += 1) channel.push(await channelTick());
      const previewAcks = window.__vmAcks.slice();
      // Every tick of this phase is one `preview` and nothing else: the draft
      // is untouched, so no `apply` and no `preview:clear` can be interleaved.

      client.clearPreview();
      await client.whenIdle();
      return { channel, endToEnd, applyAcks, previewAcks };
    },
    { vmId: VM_ID, warmup: WARMUP_TICKS, measured: MEASURED_TICKS },
  );

  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  expect(measured.endToEnd).toHaveLength(MEASURED_TICKS);
  expect(measured.channel).toHaveLength(MEASURED_TICKS);
  // One `apply` per tick and nothing else: the selection never changes during
  // the loop, so `sendSelection` posts nothing.
  expect(measured.applyAcks).toHaveLength(MEASURED_TICKS);
  expect(measured.previewAcks).toHaveLength(MEASURED_TICKS);

  report("shell-side round trip, store set to ack", summarise(measured.endToEnd));
  report("bridge round trip (diagnostic)", summarise(measured.channel));
  report("apply ack.ms inside the frame", summarise(measured.applyAcks));
  report("preview ack.ms inside the frame", summarise(measured.previewAcks));

  budget("shell-side round trip p95", percentile(measured.endToEnd, 95), END_TO_END_P95_MS);
  budget("bridge round trip p95", percentile(measured.channel, 95), CHANNEL_P95_MS);
  budget("apply ack.ms p95", percentile(measured.applyAcks, 95), ACK_P95_MS);
  budget("apply ack.ms max", Math.max(...measured.applyAcks), ACK_MAX_MS);
});

test("state:load of 200 assignments lands inside 50ms of frame time", async ({ page }) => {
  await openEditor(page);
  // Armed before the reload below, because it is also how that reload's own
  // handshake is waited for — the frame is deliberately uninstrumented here, so
  // `receivedTypes` is not available to watch it from the inside.
  await collectAcks(page);

  // The fixture has twelve tagged elements; the budget is quoted at 200, so
  // the mock route is asked for a page that size (dev-only query parameter).
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Cloned page preview"]',
    );
    if (!iframe) throw new Error("no preview iframe");
    iframe.src = `${iframe.src}?vmExtraElements=200`;
  });
  await expect(
    page.frameLocator('iframe[title="Cloned page preview"]').locator('[data-vm-id="vm-extra-200"]'),
  ).toBeAttached();
  // Same race as in the cost test above: the reload re-handshakes, and `ready`
  // makes the client re-send `state:load` *and* `select`, so two acks come
  // back. Wait for them, drain anything else still in flight, then empty the
  // buffer, so that only the `state:load` under test is timed.
  await expect.poll(() => page.evaluate(() => window.__vmAcks.length)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.__vmTest!.client.whenIdle());
  await page.evaluate(() => {
    window.__vmAcks = [];
  });

  const session = await throttle(page, 4);

  // 200 changed entries in one update is past `BULK_APPLY_LIMIT`, so the
  // client sends exactly one `state:load` (spec §5) — which is what is being
  // measured.
  await page.evaluate(() => {
    const { store, client } = window.__vmTest!;
    const draftState: Record<string, unknown> = {};
    for (let index = 1; index <= 200; index += 1) {
      draftState[`vm-extra-${index}`] = {
        animationId: "fade-in-up",
        catalogVersion: "1.1.0",
        trigger: "load",
        params: { duration: `${400 + index}ms`, distance: `${8 + (index % 40)}px` },
      };
    }
    store.setState({ draftState });
    return client.whenIdle();
  });

  const acks: number[] = await page.evaluate(() => window.__vmAcks);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  // It really loaded all 200, and each against its own params.
  const applied = await page
    .frameLocator('iframe[title="Cloned page preview"]')
    .locator('[data-vm-id="vm-extra-137"]')
    .evaluate((el) => (el as HTMLElement).style.getPropertyValue("animation-duration"));
  expect(applied).toBe("537ms");

  expect(acks.length).toBeGreaterThan(0);
  report("state:load 200 ack.ms", summarise(acks));
  budget("state:load 200 ack.ms max", Math.max(...acks), STATE_LOAD_ACK_MAX_MS);
});

/**
 * The test-only seam `lib/bridge/use-bridge.ts` installs under mocking. Typed
 * structurally here rather than imported: `apps/e2e` does not build against
 * `apps/web`, and the spec only needs these few calls.
 */
type TestAssignment = {
  animationId: string;
  catalogVersion: string;
  trigger: string;
  params: Record<string, string>;
};

type TestStore = {
  getState(): {
    draftState: Record<string, TestAssignment>;
    setSelectedVmId(vmId: string | null): void;
    dispatchPanel(event: { type: string; animationId?: string }): void;
    updateDraftParam(vmId: string, key: string, value: string): void;
  };
  setState(partial: Record<string, unknown>): void;
};

type TestClient = {
  status(): string;
  whenIdle(): Promise<void>;
  preview(vmId: string, assignment: TestAssignment): void;
  clearPreview(): void;
};

declare global {
  interface Window {
    __vmTest?: { store: TestStore; client: TestClient };
    __vmAcks: number[];
  }
}

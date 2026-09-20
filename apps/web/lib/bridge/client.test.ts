import { BULK_APPLY_LIMIT, MESSAGE_SOURCE, PROTOCOL_VERSION, type ElementInfo } from "bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Assignment } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION } from "@/lib/catalog";
import {
  createEditorStore,
  selectGuardOpen,
  selectSelectedVmId,
  type EditorStoreHook,
} from "@/lib/store";

import { createBridgeClient, type BridgeClient } from "./client";
import type { Unresolved } from "./to-applied";

const FRAME_ORIGIN = "http://127.0.0.1:3000";

type Posted = { data: { type: string; payload: unknown; seq?: number }; targetOrigin: string };

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    animationId: "fade-in-up",
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: "load",
    params: {},
    ...overrides,
  };
}

function elementInfo(vmId: string, tag = "h1"): ElementInfo {
  return {
    vmId,
    tag,
    role: null,
    textPreview: "Welcome",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    pageRect: { x: 0, y: 0, width: 10, height: 10 },
    order: 0,
    visible: true,
  };
}

/**
 * A fake frame and a fake `window`: `listenOn` hands us the client's own
 * listener so a test can deliver a message with any `origin` and `source` it
 * likes (jsdom's `MessageEvent` will not take a plain object as `source`), and
 * `raf` is a queue the test drains by hand.
 */
function harness(options: { origin?: string } = {}) {
  const posted: Posted[] = [];
  /** Every seq ever sent, including the ones `clear()` has dropped from `posted`. */
  const sentSeqs: number[] = [];
  const target = {
    postMessage(data: unknown, targetOrigin: string) {
      const message = data as Posted["data"];
      posted.push({ data: message, targetOrigin });
      if (typeof message.seq === "number") sentSeqs.push(message.seq);
    },
  } as unknown as Window;
  /** What `target()` answers; a test can take the frame away and give it back. */
  let currentTarget: Window | null = target;

  let listener: ((event: MessageEvent) => void) | null = null;
  const listenOn = {
    addEventListener(type: string, fn: EventListener) {
      if (type === "message") listener = fn as unknown as (event: MessageEvent) => void;
    },
    removeEventListener(type: string, fn: EventListener) {
      if (listener === (fn as unknown as (event: MessageEvent) => void)) listener = null;
    },
  } as unknown as Window;

  const frames: Array<() => void> = [];
  const store: EditorStoreHook = createEditorStore();
  const unresolved: Unresolved[] = [];
  const statuses: string[] = [];
  const ackErrors: Array<{ seq: number; ok: boolean; error?: string; unknownVmIds?: string[] }> = [];
  /** The ack deadlines the client has armed, so a test can fire them by hand. */
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];

  const client: BridgeClient = createBridgeClient({
    target: () => currentTarget,
    expectedOrigin: options.origin ?? FRAME_ORIGIN,
    listenOn,
    store,
    raf: (cb) => {
      frames.push(cb);
    },
    onUnresolved: (list) => unresolved.push(...list),
    onStatusChange: (status) => statuses.push(status),
    onAckError: (ack) => ackErrors.push(ack),
    setTimer: (run, ms) => {
      timers.push({ run, ms, cancelled: false });
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      const timer = timers[handle as number];
      if (timer) timer.cancelled = true;
    },
  });

  function deliver(
    type: string,
    payload: unknown,
    overrides: { origin?: string; source?: unknown } = {},
  ) {
    listener?.({
      origin: overrides.origin ?? options.origin ?? FRAME_ORIGIN,
      source: "source" in overrides ? overrides.source : currentTarget,
      data: { source: MESSAGE_SOURCE, type, payload },
    } as MessageEvent);
  }

  return {
    client,
    store,
    posted,
    unresolved,
    statuses,
    ackErrors,
    target,
    setTarget(next: Window | null) {
      currentTarget = next;
    },
    /** Deadlines still armed. */
    liveTimers: () => timers.filter((timer) => !timer.cancelled),
    /** Fire every armed deadline, the way 5 s of wall clock would. */
    expireTimers() {
      timers.filter((timer) => !timer.cancelled).forEach((timer) => timer.run());
    },
    hasListener: () => listener !== null,
    deliver,
    /** Run every rAF callback queued so far. */
    frame() {
      frames.splice(0).forEach((cb) => cb());
    },
    /** Answer every message ever sent; an ack for a seq already settled is ignored. */
    ackAll(extra: Record<string, unknown> = {}) {
      for (const seq of sentSeqs) {
        deliver("ack", { seq, ms: 0.5, ok: true, ...extra });
      }
    },
    ready(protocolVersion: number = PROTOCOL_VERSION, bridgeVersion: string = "1.1.1") {
      deliver("ready", { elementCount: 12, bridgeVersion, protocolVersion });
    },
    /** A `ready` with exactly this payload, for the ones a real bridge would never send. */
    readyWith(payload: Record<string, unknown>) {
      deliver("ready", payload);
    },
    /** Fire only the armed deadlines of this length (the query's 3 s, not the ack's 5 s). */
    expireTimersOf(ms: number) {
      timers.filter((timer) => !timer.cancelled && timer.ms === ms).forEach((timer) => timer.run());
    },
    /** The seq of the last message of `type` that went out. */
    lastSeq(type: string): number {
      const message = [...posted].reverse().find((p) => p.data.type === type);
      if (typeof message?.data.seq !== "number") throw new Error(`no ${type} was posted`);
      return message.data.seq;
    },
    types: () => posted.map((p) => p.data.type),
    clear: () => posted.splice(0),
  };
}

describe("createBridgeClient — handshake", () => {
  it("starts connecting and sends nothing on its own", () => {
    const h = harness();

    expect(h.client.status()).toBe("connecting");
    expect(h.posted).toHaveLength(0);
  });

  it("does not send draft changes before `ready`", () => {
    const h = harness();

    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.frame();

    expect(h.posted).toHaveLength(0);
  });

  it("hello() posts `hello` to the expected origin", () => {
    const h = harness();

    h.client.hello();

    expect(h.posted).toHaveLength(1);
    expect(h.posted[0].data.type).toBe("hello");
    expect(h.posted[0].targetOrigin).toBe(FRAME_ORIGIN);
    expect(h.posted[0].data.seq).toBe(1);
  });

  it("answers `ready` with exactly one state:load and one select", () => {
    const h = harness();
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.store.getState().setSelectedVmId("vm-1");

    h.ready();

    expect(h.client.status()).toBe("ready");
    expect(h.types()).toEqual(["state:load", "select"]);
    expect(h.posted[0].data.payload).toMatchObject({
      assignments: [expect.objectContaining({ vmId: "vm-1", keyframesName: "vm-fade-in-up-v1-1-0" })],
    });
    expect(h.posted[1].data.payload).toMatchObject({ vmId: "vm-1" });
    expect(h.statuses).toEqual(["ready"]);
  });

  it("re-sends the whole state on every `ready`, rejecting the acks the old frame owed", async () => {
    const h = harness();
    h.ready();
    const pendingReplay = h.client.replay(null);
    h.clear();

    h.ready();

    await expect(pendingReplay).rejects.toThrow();
    expect(h.types()).toEqual(["state:load", "select"]);
  });

  it("refuses to talk to a protocol version it does not know", () => {
    const h = harness();

    h.ready(2);

    expect(h.client.status()).toBe("version-mismatch");
    expect(h.posted).toHaveLength(0);

    // …and stays quiet from then on, including for an explicit hello().
    h.client.hello();
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.frame();
    expect(h.posted).toHaveLength(0);
  });

  it("does not read a failed `hello` ack as a handshake (spec D7)", () => {
    const h = harness();
    h.client.hello();
    h.clear();

    // The bridge could not answer yet: `ok: false`, no error code, no `ready`.
    h.deliver("ack", { seq: 1, ms: 0.1, ok: false });

    expect(h.client.status()).toBe("connecting");
    expect(h.posted).toHaveLength(0);
  });

  it("ignores messages from the wrong origin, the wrong window or a foreign envelope", () => {
    const h = harness();

    h.deliver("ready", { protocolVersion: 1 }, { origin: "http://evil.test" });
    h.deliver("ready", { protocolVersion: 1 }, { source: {} });
    expect(h.client.status()).toBe("connecting");

    h.deliver("nope", {});
    expect(h.client.status()).toBe("connecting");
    expect(h.posted).toHaveLength(0);
  });
});

describe("createBridgeClient — draft → iframe", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
    h.ready();
    h.clear();
  });

  it("coalesces a burst of param changes into one apply carrying the last value", () => {
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.frame();
    h.clear();

    for (const duration of ["200ms", "400ms", "600ms", "800ms", "1000ms"]) {
      h.store.getState().updateDraftParam("vm-1", "duration", duration);
    }
    expect(h.posted).toHaveLength(0); // nothing until the frame

    h.frame();

    expect(h.types()).toEqual(["apply"]);
    expect(h.posted[0].data.payload).toMatchObject({
      vmId: "vm-1",
      style: expect.objectContaining({ "animation-duration": "1000ms" }),
    });
  });

  it("sends `clear` for a removed assignment", () => {
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.frame();
    h.clear();

    h.store.getState().removeDraftAssignment("vm-1");
    h.frame();

    expect(h.types()).toEqual(["clear"]);
    expect(h.posted[0].data.payload).toEqual({ vmId: "vm-1" });
  });

  it("falls back to one state:load past BULK_APPLY_LIMIT changed entries", () => {
    for (let i = 0; i < BULK_APPLY_LIMIT + 1; i += 1) {
      h.store.getState().setDraftAssignment(`vm-${i}`, assignment());
    }
    h.frame();

    expect(h.types()).toEqual(["state:load"]);
    expect(h.posted[0].data.payload).toMatchObject({
      assignments: expect.arrayContaining([expect.objectContaining({ vmId: "vm-0" })]),
    });
    expect((h.posted[0].data.payload as { assignments: unknown[] }).assignments).toHaveLength(
      BULK_APPLY_LIMIT + 1,
    );
  });

  it("stays with apply at exactly BULK_APPLY_LIMIT changed entries", () => {
    for (let i = 0; i < BULK_APPLY_LIMIT; i += 1) {
      h.store.getState().setDraftAssignment(`vm-${i}`, assignment());
    }
    h.frame();

    expect(h.types()).toEqual(Array(BULK_APPLY_LIMIT).fill("apply"));
  });

  it("reports an assignment it cannot resolve instead of posting it", () => {
    h.store.getState().setDraftAssignment("vm-1", assignment({ catalogVersion: "9.9.9" }));
    h.frame();

    expect(h.posted).toHaveLength(0);
    expect(h.unresolved).toEqual([
      expect.objectContaining({ vmId: "vm-1", reason: "unknown-version" }),
    ]);
  });

  it("previews and clears a preview without touching the draft", () => {
    h.client.preview("vm-1", assignment({ animationId: "pulse" }));
    h.client.clearPreview();

    expect(h.types()).toEqual(["preview", "preview:clear"]);
    expect(h.posted[0].data.payload).toMatchObject({ animationId: "pulse" });
    expect(h.store.getState().draftState).toEqual({});
  });

  it("replay() resolves with the bridge's ack", async () => {
    const pending = h.client.replay("vm-1");
    h.deliver("ack", { seq: h.posted[0].data.seq, ms: 2.5, ok: true });

    await expect(pending).resolves.toMatchObject({ ms: 2.5, ok: true });
  });

  it("whenIdle() flushes a scheduled frame and waits for every ack", async () => {
    h.store.getState().setDraftAssignment("vm-1", assignment());

    const idle = h.client.whenIdle();
    // The flush happened without the rAF firing…
    expect(h.types()).toEqual(["apply"]);
    // …and a `state:load` ack carrying unknownVmIds still settles.
    h.ackAll({ unknownVmIds: [] });

    await expect(idle).resolves.toBeUndefined();
  });

  it("never posts to a wildcard target origin", () => {
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.store.getState().setSelectedVmId("vm-1");
    h.frame();
    h.client.hello();
    h.client.preview("vm-1", assignment());
    void h.client.replay(null);

    expect(h.posted.length).toBeGreaterThan(0);
    for (const { targetOrigin } of h.posted) {
      expect(targetOrigin).toBe(FRAME_ORIGIN);
    }
  });
});

describe("createBridgeClient — iframe → shell", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
    h.ready();
    h.clear();
  });

  it("a click inside the frame selects the element and keeps its metadata", () => {
    h.deliver("element:select", elementInfo("vm-1"));

    expect(h.store.getState().elements["vm-1"]).toMatchObject({ tag: "h1" });
    expect(h.store.getState().panel).toEqual({ status: "selected", vmId: "vm-1" });
  });

  it("selecting an element that already has a draft lands on tuning", () => {
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.deliver("element:select", elementInfo("vm-1"));

    expect(h.store.getState().panel).toMatchObject({ status: "tuning", vmId: "vm-1" });
  });

  it("answers a selection with `select`, labelled with the tag and the animation", () => {
    h.deliver("element:select", elementInfo("vm-1", "h1"));
    h.frame();

    expect(h.types()).toEqual(["select"]);
    expect(h.posted[0].data.payload).toEqual({ vmId: "vm-1", label: "h1" });

    h.clear();
    h.store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    h.store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    h.frame();

    // The ring does not move, but its label now names the animation.
    expect(h.posted.map((p) => p.data.payload)).toContainEqual({
      vmId: "vm-1",
      label: "h1 · Fade In Up",
    });
  });

  it("tracks the hovered element and its absence", () => {
    h.deliver("element:hover", elementInfo("vm-2", "button"));
    expect(h.store.getState().hoverVmId).toBe("vm-2");

    h.deliver("element:hover", { vmId: null });
    expect(h.store.getState().hoverVmId).toBeNull();
  });

  it("honours a deselect while the draft is clean", () => {
    h.deliver("element:select", elementInfo("vm-1"));
    h.deliver("element:deselect", { reason: "escape" });

    expect(selectSelectedVmId(h.store.getState())).toBeNull();
  });

  it("leaves the ring alone when the guard refuses the switch (spec D10)", () => {
    h.deliver("element:select", elementInfo("vm-1"));
    h.store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    h.store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    h.frame();
    h.clear();

    h.deliver("element:select", elementInfo("vm-2", "button"));
    h.frame();

    expect(selectSelectedVmId(h.store.getState())).toBe("vm-1");
    expect(selectGuardOpen(h.store.getState())).toBe(true);
    expect(h.types()).not.toContain("select");
  });

  it("sends the revert before the selection when the guard is discarded", () => {
    h.deliver("element:select", elementInfo("vm-1"));
    h.store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    h.store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    h.deliver("element:select", elementInfo("vm-2", "button"));
    h.frame();
    h.clear();

    h.store.getState().resolveGuard("discard");
    h.frame();

    expect(h.types()).toEqual(["clear", "select"]);
    expect(h.posted[0].data.payload).toEqual({ vmId: "vm-1" });
    expect(h.posted[1].data.payload).toEqual({ vmId: "vm-2", label: "button" });
  });
});

describe("createBridgeClient — destroy", () => {
  it("stops listening, stops sending and settles what it owed", async () => {
    const h = harness();
    h.ready();
    const pending = h.client.replay(null);
    h.clear();

    h.client.destroy();

    await expect(pending).rejects.toThrow();
    expect(h.hasListener()).toBe(false);

    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.frame();
    h.ready();
    expect(h.posted).toHaveLength(0);
  });

  it("does not raise an unhandled rejection for acks nobody awaited", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      const h = harness();
      h.ready();
      h.store.getState().setDraftAssignment("vm-1", assignment());
      h.frame();

      h.client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("createBridgeClient — hardening", () => {
  it("says nothing but `hello` before the handshake", () => {
    const h = harness();

    h.client.hello();
    h.client.preview("vm-1", assignment());
    h.client.clearPreview();
    const replay = h.client.replay("vm-1");

    expect(h.types()).toEqual(["hello"]);
    // Refused, not queued: the whole state is re-derived and sent at `ready`.
    return expect(replay).rejects.toThrow(/not ready/i);
  });

  it("does not track `hello` as a pending ack", async () => {
    const h = harness();

    h.client.hello();

    // Spec D7: a `hello` ack proves nothing — it can come back `ok: false`
    // with no `ready` behind it — so it must not be something `whenIdle()`
    // waits for, and must not arm a deadline.
    expect(h.liveTimers()).toHaveLength(0);
    await expect(h.client.whenIdle()).resolves.toBeUndefined();
  });

  it("rejects a message the frame never acks, rather than waiting forever", async () => {
    const h = harness();
    h.ready();
    // Settle the handshake's own `state:load` and `select` first, so the only
    // deadline left armed is the one under test.
    h.ackAll();
    const replay = h.client.replay("vm-1");

    expect(h.liveTimers()).toHaveLength(1);
    expect(h.liveTimers()[0].ms).toBe(5_000);

    h.expireTimers();

    await expect(replay).rejects.toThrow(/did not ack/i);
    // …and the channel is idle again, so `whenIdle()` cannot hang on it.
    await expect(h.client.whenIdle()).resolves.toBeUndefined();
  });

  it("disarms the deadline when the ack does arrive", async () => {
    const h = harness();
    h.ready();
    const replay = h.client.replay("vm-1");
    h.ackAll();

    await expect(replay).resolves.toMatchObject({ ok: true });
    expect(h.liveTimers()).toHaveLength(0);
  });

  it("flushes a scheduled frame before posting a replay, so the apply lands first", async () => {
    const h = harness();
    h.ready();
    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.clear();

    // No `frame()` — the coalescing rAF has not run yet. `replay` has to flush
    // it itself, or it restarts the animation the *old* params describe.
    const replay = h.client.replay("vm-1");

    // `select` is absent because nothing is selected and the handshake already
    // said so; the point is that the `apply` precedes the `replay`.
    expect(h.types()).toEqual(["apply", "replay"]);
    h.ackAll();
    await expect(replay).resolves.toMatchObject({ ok: true });
  });

  it("remembers a selection only once it has actually gone out", () => {
    const h = harness();
    h.ready();
    h.store.getState().setSelectedVmId("vm-1");
    h.frame();
    h.clear();

    // The frame goes away mid-flight: the `select` is refused…
    h.setTarget(null);
    h.store.getState().setSelectedVmId("vm-2");
    h.frame();
    expect(h.types()).toEqual([]);

    // …so when it comes back, the ring is still told where to go.
    h.setTarget(h.target);
    h.store.getState().rememberElement(elementInfo("vm-2", "p"));
    h.frame();
    expect(h.types()).toEqual(["select"]);
    expect(h.posted[0].data.payload).toMatchObject({ vmId: "vm-2" });
  });

  it("reports an ack the bridge refused", () => {
    const h = harness();
    h.ready();
    h.client.replay("vm-1").catch(() => {});
    const seq = h.posted.at(-1)?.data.seq;

    h.deliver("ack", { seq, ms: 0.2, ok: false, error: "unknown-element" });

    expect(h.ackErrors).toEqual([{ seq, ms: 0.2, ok: false, error: "unknown-element" }]);
  });

  it("reports a state:load the frame could only partly place", () => {
    const h = harness();
    h.ready();
    const seq = h.posted[0]?.data.seq;

    h.deliver("ack", { seq, ms: 1, ok: true, unknownVmIds: ["vm-9"] });

    expect(h.ackErrors).toHaveLength(1);
    expect(h.ackErrors[0]).toMatchObject({ ok: true, unknownVmIds: ["vm-9"] });
  });

  it("says nothing about an ack that simply succeeded", () => {
    const h = harness();
    h.ready();
    h.deliver("ack", { seq: h.posted[0]?.data.seq, ms: 1, ok: true, unknownVmIds: [] });

    expect(h.ackErrors).toEqual([]);
  });

  it("says nothing about a `hello` the frame acked `ok: false`", () => {
    const h = harness();

    // Spec D7: before the frame's body is parsed, `ok: false` is `hello`'s
    // *normal* answer and proves nothing. Reporting it would put an error in
    // the panel on an ordinary page load, before the handshake has even failed.
    h.client.hello();
    const seq = h.posted.at(-1)?.data.seq;
    h.deliver("ack", { seq, ms: 0.1, ok: false });

    expect(h.ackErrors).toEqual([]);

    // …and the very next refusal, on a real message, is still reported.
    h.ready();
    h.client.replay("vm-1").catch(() => {});
    const replaySeq = h.posted.at(-1)?.data.seq;
    h.deliver("ack", { seq: replaySeq, ms: 0.2, ok: false, error: "unknown-element" });

    expect(h.ackErrors).toEqual([{ seq: replaySeq, ms: 0.2, ok: false, error: "unknown-element" }]);
  });

  it("drops an element:select whose payload is not an ElementInfo", () => {
    const h = harness();
    h.ready();

    h.deliver("element:select", { vmId: "vm-1", tag: 42, role: null, textPreview: "" });
    h.deliver("element:select", { vmId: "vm-1" });
    h.deliver("element:select", null);

    // `tag` is rendered into the guard's question; a number would throw in
    // React the moment the dialog opened.
    expect(h.store.getState().elements).toEqual({});
    expect(selectSelectedVmId(h.store.getState())).toBeNull();

    h.deliver("element:select", elementInfo("vm-1", "h1"));
    expect(h.store.getState().elements["vm-1"]).toMatchObject({ tag: "h1" });
  });

  it("clears an active preview before an apply that would land under it", () => {
    const h = harness();
    h.ready();
    h.client.preview("vm-1", assignment());
    h.clear();

    h.store.getState().setDraftAssignment("vm-1", assignment({ params: { duration: "900ms" } }));
    h.frame();

    // Spec D6: an `apply` during a preview updates the layer *underneath*, so
    // without this the tuned value is applied and invisible.
    expect(h.types()).toEqual(["preview:clear", "apply"]);
  });

  it("clears an active preview before a state:load", () => {
    const h = harness();
    h.ready();
    h.client.preview("vm-1", assignment());
    h.clear();

    for (let index = 0; index < BULK_APPLY_LIMIT + 1; index += 1) {
      h.store.getState().setDraftAssignment(`vm-${index}`, assignment());
    }
    h.frame();

    expect(h.types()).toEqual(["preview:clear", "state:load"]);
  });

  it("leaves another element's apply alone while a preview is up", () => {
    const h = harness();
    h.ready();
    h.client.preview("vm-1", assignment());
    h.clear();

    h.store.getState().setDraftAssignment("vm-2", assignment());
    h.frame();

    expect(h.types()).toEqual(["apply"]);
  });

  it("forgets the preview once it has been cleared", () => {
    const h = harness();
    h.ready();
    h.client.preview("vm-1", assignment());
    h.client.clearPreview();
    h.clear();

    h.store.getState().setDraftAssignment("vm-1", assignment());
    h.frame();

    expect(h.types()).toEqual(["apply"]);
  });

  it("posts nothing on clearPreview() when no preview is up", () => {
    const h = harness();
    h.ready();
    h.clear();

    // Every hover-out calls this, and the frame's `dropPreview` acks `ok: true`
    // with nothing to drop — one message per hover-out for a no-op. The
    // internal `clearActivePreview` has always had this early return; this is
    // the one path that did not mirror it.
    h.client.clearPreview();
    expect(h.types()).toEqual([]);

    // Twice in a row, which is what a flush followed by a hover-out produces.
    h.client.preview("vm-1", assignment());
    h.client.clearPreview();
    h.client.clearPreview();

    expect(h.types()).toEqual(["preview", "preview:clear"]);
  });
});

describe("createBridgeClient — queryElements", () => {
  const VIEWPORT = { width: 1200, height: 600 };
  const QUERY = { filter: { tags: ["h1", "p"], minWidth: 40, minHeight: 40 }, limit: 200 };

  /** Handshaken, the handshake's own messages acked and out of the way. */
  function readyHarness(bridgeVersion = "1.1.1") {
    const h = harness();
    h.ready(PROTOCOL_VERSION, bridgeVersion);
    h.ackAll();
    h.clear();
    return h;
  }

  function list(seq: number, overrides: Record<string, unknown> = {}) {
    return {
      seq,
      elements: [elementInfo("vm-1", "h1"), elementInfo("vm-2", "p")],
      truncated: false,
      viewport: VIEWPORT,
      ...overrides,
    };
  }

  it("posts `elements:query` with a fresh seq to the expected origin, never `*`", () => {
    const h = readyHarness();
    const before = h.client.replay(null);
    void before;
    const replaySeq = h.lastSeq("replay");

    void h.client.queryElements(QUERY);

    const message = h.posted[h.posted.length - 1];
    expect(message.data.type).toBe("elements:query");
    expect(message.data.payload).toEqual(QUERY);
    expect(message.data.seq).toBe(replaySeq + 1);
    expect(Number.isInteger(message.data.seq)).toBe(true);
    expect(message.targetOrigin).toBe(FRAME_ORIGIN);
    expect(h.posted.every((p) => p.targetOrigin !== "*")).toBe(true);
  });

  it("sends an empty payload when called with no query", () => {
    const h = readyHarness();

    void h.client.queryElements();

    expect(h.posted[0].data).toMatchObject({ type: "elements:query", payload: {} });
  });

  it("resolves with the matching `elements:list` and remembers every element", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    const seq = h.lastSeq("elements:query");

    h.deliver("elements:list", list(seq, { truncated: true }));
    h.ackAll();

    await expect(query).resolves.toEqual({
      elements: [elementInfo("vm-1", "h1"), elementInfo("vm-2", "p")],
      truncated: true,
      viewport: VIEWPORT,
    });
    expect(h.store.getState().elements["vm-1"]).toEqual(elementInfo("vm-1", "h1"));
    expect(h.store.getState().elements["vm-2"]).toEqual(elementInfo("vm-2", "p"));
  });

  it("remembers a whole list in one store update", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    let notifications = 0;
    h.store.subscribe(() => {
      notifications += 1;
    });

    h.deliver("elements:list", list(h.lastSeq("elements:query")));
    await query;

    expect(notifications).toBe(1);
  });

  it("ignores a list for another seq, and one nobody asked for", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    const seq = h.lastSeq("elements:query");
    let settled = false;
    void query.then(
      () => (settled = true),
      () => (settled = true),
    );

    h.deliver("elements:list", list(seq + 100, { elements: [elementInfo("vm-9")] }));
    h.deliver("elements:list", { seq: "nope" });
    h.deliver("elements:list", null);
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(h.store.getState().elements["vm-9"]).toBeUndefined();

    h.deliver("elements:list", list(seq));
    await expect(query).resolves.toMatchObject({ truncated: false });
  });

  it("keeps two queries in flight apart", async () => {
    const h = readyHarness();
    const first = h.client.queryElements(QUERY);
    const firstSeq = h.lastSeq("elements:query");
    const second = h.client.queryElements(QUERY);
    const secondSeq = h.lastSeq("elements:query");

    h.deliver("elements:list", list(secondSeq, { elements: [elementInfo("vm-2", "p")] }));
    h.deliver("elements:list", list(firstSeq, { elements: [elementInfo("vm-1", "h1")] }));

    expect((await first).elements.map((element) => element.vmId)).toEqual(["vm-1"]);
    expect((await second).elements.map((element) => element.vmId)).toEqual(["vm-2"]);
  });

  it("resolves on a list that arrives before the ack, and whenIdle() still waits for that ack", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    const seq = h.lastSeq("elements:query");

    h.deliver("elements:list", list(seq));
    await expect(query).resolves.toMatchObject({ viewport: VIEWPORT });

    let idle = false;
    const whenIdle = h.client.whenIdle().then(() => {
      idle = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(idle).toBe(false);

    h.deliver("ack", { seq, ms: 1, ok: true });
    await whenIdle;
    expect(idle).toBe(true);
    // Both deadlines — the query's and the ack's — are disarmed.
    expect(h.liveTimers()).toHaveLength(0);
  });

  it("drops elements that are not an ElementInfo", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);

    h.deliver(
      "elements:list",
      list(h.lastSeq("elements:query"), {
        elements: [elementInfo("vm-1"), { vmId: "vm-bad", tag: 7 }, null, elementInfo("vm-2", "p")],
      }),
    );

    expect((await query).elements.map((element) => element.vmId)).toEqual(["vm-1", "vm-2"]);
    expect(h.store.getState().elements["vm-bad"]).toBeUndefined();
  });

  it.each([
    ["a non-array `elements`", { elements: "many" }],
    ["a non-boolean `truncated`", { truncated: "no" }],
    ["a missing viewport", { viewport: undefined }],
    ["a non-numeric viewport", { viewport: { width: "1200", height: 600 } }],
    ["a non-finite viewport", { viewport: { width: 1200, height: Number.NaN } }],
  ])("rejects %s as elements-query-invalid", async (_name, overrides) => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);

    h.deliver("elements:list", list(h.lastSeq("elements:query"), overrides));

    await expect(query).rejects.toThrow("elements-query-invalid");
    expect(h.store.getState().elements).toEqual({});
  });

  it("rejects with elements-query-timeout after 3000 ms, on its own timer", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    const seq = h.lastSeq("elements:query");

    expect(h.liveTimers().map((timer) => timer.ms).sort()).toEqual([3_000, 5_000]);

    h.expireTimersOf(3_000);

    await expect(query).rejects.toThrow("elements-query-timeout");
    // The seq is still owed an ack: `whenIdle()` stays honest…
    expect(h.liveTimers().map((timer) => timer.ms)).toEqual([5_000]);
    // …and a list that turns up late is ignored.
    h.deliver("elements:list", list(seq));
    expect(h.store.getState().elements).toEqual({});

    h.deliver("ack", { seq, ms: 1, ok: true });
    await expect(h.client.whenIdle()).resolves.toBeUndefined();
  });

  it("rejects at once when the ack says ok but no list ever came (the list always precedes the ack)", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    const seq = h.lastSeq("elements:query");

    h.deliver("ack", { seq, ms: 1, ok: true });

    await expect(query).rejects.toThrow("elements-query-invalid");
    expect(h.liveTimers()).toHaveLength(0);
    expect(h.ackErrors).toEqual([]);
  });

  it("honours `queryTimeoutMs`", () => {
    const posted: unknown[] = [];
    const armed: number[] = [];
    const frame = { postMessage: (data: unknown) => posted.push(data) } as unknown as Window;
    let listener: ((event: MessageEvent) => void) | null = null;
    const client = createBridgeClient({
      target: () => frame,
      expectedOrigin: FRAME_ORIGIN,
      listenOn: {
        addEventListener: (_type: string, fn: EventListener) => {
          listener = fn as unknown as (event: MessageEvent) => void;
        },
        removeEventListener: () => {},
      } as unknown as Window,
      store: createEditorStore(),
      raf: () => {},
      setTimer: (_run, ms) => armed.push(ms),
      clearTimer: () => {},
      queryTimeoutMs: 750,
    });
    (listener as unknown as (event: MessageEvent) => void)({
      origin: FRAME_ORIGIN,
      source: frame,
      data: {
        source: MESSAGE_SOURCE,
        type: "ready",
        payload: { elementCount: 1, bridgeVersion: "1.1.1", protocolVersion: PROTOCOL_VERSION },
      },
    } as MessageEvent);
    armed.length = 0;

    client.queryElements().catch(() => {});

    expect(armed).toContain(750);
    client.destroy();
  });

  it("rejects with elements-query-rejected when its ack is `ok: false`, without reporting an ack error", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);
    const seq = h.lastSeq("elements:query");

    h.deliver("ack", { seq, ms: 1, ok: false, error: "invalid-payload" });

    await expect(query).rejects.toThrow("elements-query-rejected");
    expect(h.liveTimers()).toHaveLength(0);
    // The draft and the frame still agree; the caller has the rejection.
    expect(h.ackErrors).toEqual([]);
    await expect(h.client.whenIdle()).resolves.toBeUndefined();
  });

  it("rejects when a new `ready` arrives", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);

    h.ready();

    await expect(query).rejects.toThrow(/preview frame reloaded/);
    expect(h.liveTimers().every((timer) => timer.ms !== 3_000)).toBe(true);
  });

  it("rejects on destroy", async () => {
    const h = readyHarness();
    const query = h.client.queryElements(QUERY);

    h.client.destroy();

    await expect(query).rejects.toThrow(/destroyed/);
    expect(h.liveTimers()).toHaveLength(0);
  });

  it("rejects at once, and posts nothing, while the bridge is not ready", async () => {
    const h = harness();

    await expect(h.client.queryElements(QUERY)).rejects.toThrow(/not ready/i);

    h.ready(PROTOCOL_VERSION + 1);
    await expect(h.client.queryElements(QUERY)).rejects.toThrow(/version mismatch/i);

    expect(h.posted).toHaveLength(0);
    expect(h.liveTimers()).toHaveLength(0);
  });

  it("rejects at once when the frame is gone", async () => {
    const h = readyHarness();
    h.setTarget(null);

    await expect(h.client.queryElements(QUERY)).rejects.toThrow(/not available/i);
  });

  it("accepts bridge 1.1.1 and refuses 1.0.0 as bridge-too-old", async () => {
    const current = readyHarness("1.1.1");
    void current.client.queryElements(QUERY).catch(() => {});
    expect(current.types()).toEqual(["elements:query"]);

    const old = readyHarness("1.0.0");
    await expect(old.client.queryElements(QUERY)).rejects.toThrow("bridge-too-old");
    expect(old.posted).toHaveLength(0);
    expect(old.liveTimers()).toHaveLength(0);
  });

  it("reports the frame's bridgeVersion: null before `ready`, this frame's after, null when unusable", () => {
    const h = harness();
    expect(h.client.bridgeVersion()).toBeNull();

    h.ready(PROTOCOL_VERSION, "1.1.1");
    expect(h.client.bridgeVersion()).toBe("1.1.1");

    h.ready(PROTOCOL_VERSION, "1.0.0");
    expect(h.client.bridgeVersion()).toBe("1.0.0");

    h.readyWith({ elementCount: 1, protocolVersion: PROTOCOL_VERSION, bridgeVersion: 1.1 });
    expect(h.client.bridgeVersion()).toBeNull();
  });

  it("refuses a `ready` with no usable bridgeVersion as bridge-too-old", async () => {
    for (const bridgeVersion of [undefined, 1.1, "latest"]) {
      const h = harness();
      h.readyWith({ elementCount: 1, protocolVersion: PROTOCOL_VERSION, bridgeVersion });
      h.clear();

      await expect(h.client.queryElements(QUERY)).rejects.toThrow("bridge-too-old");
      expect(h.posted).toHaveLength(0);
    }
  });

  it("forgets the old frame's version on every `ready`", async () => {
    const h = readyHarness("1.1.1");

    h.ready(PROTOCOL_VERSION, "1.0.0");
    await expect(h.client.queryElements(QUERY)).rejects.toThrow("bridge-too-old");

    h.ready(PROTOCOL_VERSION, "1.10.0");
    h.clear();
    void h.client.queryElements(QUERY).catch(() => {});
    expect(h.types()).toEqual(["elements:query"]);
  });

  it("raises no unhandled rejection: a settled query's ack deferred, a query nobody awaited", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      const h = readyHarness();
      // Resolved by its list; its ack never comes and the ack deadline fires.
      const answered = h.client.queryElements(QUERY);
      h.deliver("elements:list", list(h.lastSeq("elements:query")));
      await answered;
      h.expireTimers();

      // Timed out, then the frame reloads under the ack it still owed.
      const timedOut = h.client.queryElements(QUERY);
      h.expireTimersOf(3_000);
      await expect(timedOut).rejects.toThrow("elements-query-timeout");
      h.ready();

      // Fire-and-forget, then destroyed.
      void h.client.queryElements(QUERY);
      void h.client.queryElements(QUERY);
      h.client.destroy();
      void h.client.queryElements(QUERY);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

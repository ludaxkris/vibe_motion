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

  const client: BridgeClient = createBridgeClient({
    target: () => target,
    expectedOrigin: options.origin ?? FRAME_ORIGIN,
    listenOn,
    store,
    raf: (cb) => {
      frames.push(cb);
    },
    onUnresolved: (list) => unresolved.push(...list),
    onStatusChange: (status) => statuses.push(status),
  });

  function deliver(
    type: string,
    payload: unknown,
    overrides: { origin?: string; source?: unknown } = {},
  ) {
    listener?.({
      origin: overrides.origin ?? options.origin ?? FRAME_ORIGIN,
      source: "source" in overrides ? overrides.source : target,
      data: { source: MESSAGE_SOURCE, type, payload },
    } as MessageEvent);
  }

  return {
    client,
    store,
    posted,
    unresolved,
    statuses,
    target,
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
    ready(protocolVersion: number = PROTOCOL_VERSION) {
      deliver("ready", { elementCount: 12, bridgeVersion: "1.0.0", protocolVersion });
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

/**
 * The shell half of the preview bridge: an origin-checked `postMessage`
 * channel between the editor's draft store and the script running inside the
 * cloned page's iframe.
 *
 * Contract: docs/plans/phase-4-bridge-protocol.md (§2 envelope and checks, §5
 * shell-side behaviour, D7 handshake, D10 "a click never moves the ring").
 *
 * Framework-free on purpose. It takes a `Window` to talk to, an origin to
 * check, a `Window` to listen on and a store handle — no React, no hooks, an
 * injectable `requestAnimationFrame` — so its tests drive it with a fake frame
 * and a real `createEditorStore()`, and Task 9's React hook is a thin mount.
 *
 * Nothing in here calls the API: live preview is a client-side draft
 * (CLAUDE.md rule 9).
 */
import {
  BULK_APPLY_LIMIT,
  MESSAGE_SOURCE,
  PROTOCOL_VERSION,
  isEnvelope,
  type Ack,
  type AppliedAssignment,
  type ElementInfo,
} from "bridge";

import type { Assignment, EditorStateMap } from "@/lib/api-client";
import { getCatalogEntryAt } from "@/lib/catalog";
import { selectSelectedVmId, type EditorState, type EditorStoreApi } from "@/lib/store";

import { isUnresolved, toApplied, type Unresolved } from "./to-applied";

/**
 * `connecting` — no usable `ready` yet; only `hello` goes out.
 * `ready` — handshaken, the channel carries the draft.
 * `version-mismatch` — the frame speaks a protocol this build does not know,
 * so the shell says nothing at all and shows a reload banner (spec D7).
 */
export type BridgeStatus = "connecting" | "ready" | "version-mismatch";

export type BridgeClientOptions = {
  /** The iframe's `contentWindow`, read on every send: it changes on navigation. */
  target: () => Window | null;
  /** The frame's origin. Every inbound `event.origin` must equal it, and it is every outbound target origin. */
  expectedOrigin: string;
  /** Where `message` events arrive — the shell's own `window`. */
  listenOn: Window;
  /** `useEditorStore`, or a `createEditorStore()` instance in tests. */
  store: EditorStoreApi;
  /** Injectable for tests; defaults to `window.requestAnimationFrame`. */
  raf?: (callback: () => void) => void;
  /** Draft entries whose pinned catalog entry could not be resolved: reported, never sent. */
  onUnresolved?: (unresolved: Unresolved[]) => void;
  /** Status changes. `status()` alone cannot re-render a React tree. */
  onStatusChange?: (status: BridgeStatus) => void;
};

export type BridgeClient = {
  status: () => BridgeStatus;
  /** Ask the frame to re-send `ready`. Call on mount and on the iframe's `load` event. */
  hello: () => void;
  /** Show an assignment transiently, without touching the draft (spec D4). */
  preview: (vmId: string, assignment: Assignment) => void;
  clearPreview: () => void;
  /** Restart one element's animation, or every one when `null`. */
  replay: (vmId: string | null) => Promise<Ack>;
  /** Flush any frame still scheduled, then resolve once every sent `seq` has been acked. */
  whenIdle: () => Promise<void>;
  destroy: () => void;
};

export type { Ack };

type Deferred = {
  resolve: (ack: Ack) => void;
  reject: (error: Error) => void;
  promise: Promise<Ack>;
};

/**
 * A promise for an ack that nobody is obliged to await.
 *
 * Every send gets one, but only `replay()` hands it out, so the rest would be
 * unhandled rejections the moment a `ready` or a `destroy()` rejects them. One
 * no-op handler attached here marks them handled without hiding anything from
 * a caller who attaches their own.
 */
function defer(): Deferred {
  let resolve!: (ack: Ack) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Ack>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { resolve, reject, promise };
}

function refused(reason: string): Promise<Ack> {
  const promise = Promise.reject(new Error(reason));
  promise.catch(() => {});
  return promise;
}

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const { target, expectedOrigin, listenOn, store } = options;
  const raf =
    options.raf ??
    ((callback: () => void) => {
      window.requestAnimationFrame(callback);
    });

  let status: BridgeStatus = "connecting";
  let destroyed = false;
  let seq = 0;

  const pending = new Map<number, Deferred>();
  /** vmIds whose draft entry changed since the last flush, coalesced per frame (§5). */
  const changed = new Set<string>();
  let frameScheduled = false;
  /**
   * What the ring was last told. The comparison is what implements D10: a
   * selection the guard refused never reached the store, so nothing here
   * changes and no `select` is posted. The label is part of it so that picking
   * an animation refreshes the ring's caption without moving the ring.
   */
  let sentSelection: { vmId: string | null; label: string | undefined } | null = null;

  function setStatus(next: BridgeStatus): void {
    if (status === next) return;
    status = next;
    options.onStatusChange?.(next);
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  function post(type: string, payload: unknown): Promise<Ack> {
    if (destroyed) return refused("bridge client destroyed");
    // Spec D7: on a protocol version we do not know, the shell sends nothing.
    if (status === "version-mismatch") return refused("bridge protocol version mismatch");
    const frame = target();
    if (!frame) return refused("preview frame is not available");

    seq += 1;
    const current = seq;
    const deferred = defer();
    pending.set(current, deferred);
    try {
      // Never `"*"`: that would hand the draft to whatever happens to be framed.
      frame.postMessage({ source: MESSAGE_SOURCE, type, payload, seq: current }, expectedOrigin);
    } catch (error) {
      pending.delete(current);
      deferred.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return deferred.promise;
  }

  function settleAll(error: Error): void {
    const owed = [...pending.values()];
    pending.clear();
    owed.forEach((deferred) => deferred.reject(error));
  }

  function report(unresolved: Unresolved[]): void {
    if (unresolved.length > 0) options.onUnresolved?.(unresolved);
  }

  /** Every draft entry that resolves, plus the ones that did not, for the panel. */
  function build(draftState: EditorStateMap, vmIds: readonly string[]) {
    const assignments: AppliedAssignment[] = [];
    const unresolved: Unresolved[] = [];
    for (const vmId of vmIds) {
      const assignment = draftState[vmId];
      if (!assignment) continue;
      const applied = toApplied(vmId, assignment);
      if (isUnresolved(applied)) unresolved.push(applied);
      else assignments.push(applied);
    }
    return { assignments, unresolved };
  }

  function sendStateLoad(): void {
    const { draftState } = store.getState();
    const { assignments, unresolved } = build(draftState, Object.keys(draftState));
    report(unresolved);
    void post("state:load", { assignments });
  }

  /** `h1 · Fade In Up` — the tag from the bridge's own metadata, the name from the pinned entry. */
  function selectionLabel(state: EditorState, vmId: string | null): string | undefined {
    if (vmId === null) return undefined;
    const tag = state.elements[vmId]?.tag;
    // Without metadata there is no honest label; the bridge falls back to the
    // element's own tag, which is the same answer from a better vantage point.
    if (!tag) return undefined;
    const assignment = state.draftState[vmId];
    if (!assignment) return tag;
    const entry = getCatalogEntryAt(assignment.catalogVersion, assignment.animationId);
    return `${tag} · ${entry?.name ?? assignment.animationId}`;
  }

  function sendSelection(force = false): void {
    const state = store.getState();
    const vmId = selectSelectedVmId(state);
    const label = selectionLabel(state, vmId);
    if (!force && sentSelection && sentSelection.vmId === vmId && sentSelection.label === label) {
      return;
    }
    sentSelection = { vmId, label };
    void post("select", label === undefined ? { vmId } : { vmId, label });
  }

  // -------------------------------------------------------------------------
  // Coalescing (§5: one frame's worth of draft edits becomes one batch)
  // -------------------------------------------------------------------------

  function schedule(): void {
    if (frameScheduled) return;
    frameScheduled = true;
    // No `cancelAnimationFrame`: the flag is the cancellation, so `whenIdle()`
    // and a `ready` can flush or drop the batch without owning the handle.
    raf(() => {
      if (frameScheduled) flush();
    });
  }

  function flush(): void {
    frameScheduled = false;
    if (destroyed || status !== "ready") {
      changed.clear();
      return;
    }

    if (changed.size > 0) {
      const vmIds = [...changed];
      changed.clear();
      const { draftState } = store.getState();

      if (vmIds.length > BULK_APPLY_LIMIT) {
        // What Phase 5's auto-generate produces: one stylesheet rebuild in the
        // frame instead of N messages (§5, §6).
        sendStateLoad();
      } else {
        const unresolved: Unresolved[] = [];
        for (const vmId of vmIds) {
          const assignment = draftState[vmId];
          if (!assignment) {
            void post("clear", { vmId });
            continue;
          }
          const applied = toApplied(vmId, assignment);
          if (isUnresolved(applied)) unresolved.push(applied);
          else void post("apply", applied);
        }
        report(unresolved);
      }
    }

    // Last, and in the same flush: `resolveGuard("discard")` reverts an element
    // and moves the selection in one turn, and the frame has to see the revert
    // before the ring leaves the element it was describing.
    sendSelection();
  }

  const unsubscribe = store.subscribe((state, previous) => {
    // Before `ready` nothing is queued: the full draft is re-derived and sent
    // as one `state:load` the moment the frame announces itself (§5).
    if (status !== "ready") return;

    const draftChanged = state.draftState !== previous.draftState;
    if (draftChanged) {
      for (const vmId of new Set([
        ...Object.keys(previous.draftState),
        ...Object.keys(state.draftState),
      ])) {
        if (previous.draftState[vmId] !== state.draftState[vmId]) changed.add(vmId);
      }
    }

    // `panel` carries the selection; `elements` carries the tag its label needs.
    if (draftChanged || state.panel !== previous.panel || state.elements !== previous.elements) {
      schedule();
    }
  });

  // -------------------------------------------------------------------------
  // Receiving (§2: origin, source, envelope and known type must all pass)
  // -------------------------------------------------------------------------

  function onReady(payload: unknown): void {
    const version = (payload as { protocolVersion?: unknown } | null)?.protocolVersion;
    if (version !== PROTOCOL_VERSION) {
      settleAll(new Error("bridge protocol version mismatch"));
      setStatus("version-mismatch");
      return;
    }

    // A `ready` is a frame that has just (re)built itself: whatever it owed is
    // never coming, and whatever we had queued for the old one is superseded
    // by the `state:load` below.
    settleAll(new Error("preview frame reloaded"));
    changed.clear();
    frameScheduled = false;
    sentSelection = null;
    setStatus("ready");

    sendStateLoad();
    sendSelection(true);
  }

  function onAck(payload: unknown): void {
    const ack = payload as Ack | null;
    if (!ack || typeof ack.seq !== "number") return;
    const deferred = pending.get(ack.seq);
    if (!deferred) return;
    pending.delete(ack.seq);
    deferred.resolve(ack);
  }

  function onMessage(event: MessageEvent): void {
    if (destroyed) return;
    if (event.origin !== expectedOrigin) return;
    if (event.source !== target()) return;
    const data = event.data;
    if (!isEnvelope(data)) return;

    const actions = store.getState();
    switch (data.type) {
      case "ready":
        onReady(data.payload);
        return;
      case "ack":
        onAck(data.payload);
        return;
      case "element:hover": {
        const payload = data.payload as { vmId?: unknown } | null;
        const vmId = payload?.vmId;
        actions.setHoverVmId(typeof vmId === "string" ? vmId : null);
        return;
      }
      case "element:select": {
        const info = data.payload as ElementInfo | null;
        if (!info || typeof info.vmId !== "string") return;
        actions.rememberElement(info);
        // A request, not a move: the guard may refuse it, and then no `select`
        // goes back and the ring stays where it is (spec D10).
        actions.requestSelect(info.vmId);
        return;
      }
      case "element:deselect":
        actions.requestSelect(null);
        return;
      default:
        // Unknown types are ignored, so the bridge can grow messages the shell
        // has not learned yet (spec §2).
        return;
    }
  }

  listenOn.addEventListener("message", onMessage as EventListener);

  return {
    status: () => status,

    hello: () => {
      void post("hello", {});
    },

    preview: (vmId, assignment) => {
      const applied = toApplied(vmId, assignment);
      if (isUnresolved(applied)) {
        report([applied]);
        return;
      }
      void post("preview", applied);
    },

    clearPreview: () => {
      void post("preview:clear", {});
    },

    replay: (vmId) => post("replay", { vmId }),

    whenIdle: async () => {
      if (frameScheduled) flush();
      while (pending.size > 0) {
        await Promise.allSettled([...pending.values()].map((deferred) => deferred.promise));
      }
    },

    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      frameScheduled = false;
      changed.clear();
      listenOn.removeEventListener("message", onMessage as EventListener);
      unsubscribe();
      settleAll(new Error("bridge client destroyed"));
    },
  };
}

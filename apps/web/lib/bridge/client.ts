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
  /**
   * An ack the bridge refused (`ok: false`), or one that named vmIds it could
   * not place. Either way the store and the frame now differ, and only the
   * panel can say so.
   */
  onAckError?: (ack: Ack) => void;
  /** Injectable for tests; defaults to `setTimeout` / `clearTimeout`. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** How long a sent message may go unacked before its promise is rejected. */
  ackTimeoutMs?: number;
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
  /** Handle of the deadline armed for this seq, cleared when it settles. */
  timer?: unknown;
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

  const setTimer =
    options.setTimer ??
    ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  /** Generous against a measured p95 of about 2 ms; this is a stuck frame, not a slow one. */
  const ackTimeoutMs = options.ackTimeoutMs ?? 5_000;

  let status: BridgeStatus = "connecting";
  let destroyed = false;
  let seq = 0;
  /**
   * The element a `preview` is currently showing on, or null.
   *
   * A preview sits on top of the applied assignment (spec D6), so an `apply`
   * or a `state:load` that lands under one is invisible. The client knows when
   * it started a preview, so it is the right place to end it — see `flush`.
   */
  let previewVmId: string | null = null;

  const pending = new Map<number, Deferred>();
  /**
   * Seqs whose ack must never reach `onAckError`. Only `hello` lands here; see
   * `send`. Emptied as each ack arrives and by `settleAll`.
   */
  const unreported = new Set<number>();
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

  /**
   * Why a post would be refused right now, or null when it would go out.
   *
   * "Nothing but `hello` before the handshake" is the load-bearing clause: a
   * message posted to a frame whose document is not on `expectedOrigin` yet —
   * still loading, a 5xx page, a network error page — is dropped by the
   * browser and never acked. Queuing it would be pointless anyway, because the
   * whole state is re-derived and sent as one `state:load` the moment the
   * frame announces itself.
   */
  function refusalReason(type: string): string | null {
    if (destroyed) return "bridge client destroyed";
    // Spec D7: on a protocol version we do not know, the shell sends nothing.
    if (status === "version-mismatch") return "bridge protocol version mismatch";
    if (type !== "hello" && status !== "ready") return "bridge is not ready";
    if (!target()) return "preview frame is not available";
    return null;
  }

  /** Post, and report whether the message actually left. */
  function send(type: string, payload: unknown): { sent: boolean; ack: Promise<Ack> } {
    const reason = refusalReason(type);
    if (reason !== null) return { sent: false, ack: refused(reason) };

    const frame = target();
    if (!frame) return { sent: false, ack: refused("preview frame is not available") };

    seq += 1;
    const current = seq;
    // `hello` is deliberately untracked: spec D7 says its ack proves nothing
    // (it can come back `ok: false` with no `ready` behind it), so waiting on
    // one would make `whenIdle()` wait for something that means nothing.
    const tracked = type !== "hello";
    // …and for the same reason its ack is never reported as an error: spec D7
    // makes `ok: false` the *normal* answer while the frame's body is not
    // parsed yet, so surfacing it would put an error in front of the designer
    // on an ordinary page load. Seqs are monotonic and never reused, so an
    // entry left here by a `hello` that is never acked is one stale number.
    if (!tracked) unreported.add(current);
    const deferred = defer();
    if (tracked) {
      pending.set(current, deferred);
      deferred.timer = setTimer(() => {
        if (pending.get(current) !== deferred) return;
        pending.delete(current);
        deferred.reject(new Error(`the preview frame did not ack ${type} within ${ackTimeoutMs}ms`));
      }, ackTimeoutMs);
    }
    try {
      // Never `"*"`: that would hand the draft to whatever happens to be framed.
      frame.postMessage({ source: MESSAGE_SOURCE, type, payload, seq: current }, expectedOrigin);
    } catch (error) {
      settle(current, deferred);
      deferred.reject(error instanceof Error ? error : new Error(String(error)));
      return { sent: false, ack: deferred.promise };
    }
    return { sent: true, ack: deferred.promise };
  }

  function post(type: string, payload: unknown): Promise<Ack> {
    return send(type, payload).ack;
  }

  /** Take a seq out of flight and disarm its deadline. */
  function settle(current: number, deferred: Deferred): void {
    pending.delete(current);
    if (deferred.timer !== undefined) clearTimer(deferred.timer);
  }

  function settleAll(error: Error): void {
    unreported.clear();
    const owed = [...pending.entries()];
    pending.clear();
    owed.forEach(([, deferred]) => {
      if (deferred.timer !== undefined) clearTimer(deferred.timer);
      deferred.reject(error);
    });
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

  function clearActivePreview(): void {
    if (previewVmId === null) return;
    previewVmId = null;
    void post("preview:clear", {});
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
    // Recorded only once it has actually gone out. Remembering a `select` that
    // was refused — no frame for a moment, not ready yet — would make the
    // identity guard above suppress every retry, and the ring would sit on the
    // old element until the selection changed again.
    const { sent } = send("select", label === undefined ? { vmId } : { vmId, label });
    if (sent) sentSelection = { vmId, label };
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

      // A preview sits on top of the applied assignment (spec D6), so anything
      // written underneath it is invisible until the preview ends. The client
      // started the preview, so it ends it — one message, before the batch.
      const masked =
        previewVmId !== null && (vmIds.length > BULK_APPLY_LIMIT || vmIds.includes(previewVmId));
      if (masked) clearActivePreview();

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
    // The `state:load` below drops the preview frame-side (spec §3), so the
    // client's record of one would be stale from here on.
    previewVmId = null;
    setStatus("ready");

    sendStateLoad();
    sendSelection(true);
  }

  function onAck(payload: unknown): void {
    const ack = payload as Ack | null;
    if (!ack || typeof ack.seq !== "number") return;
    // Reported whether or not anyone is *awaiting* this seq — a refused `apply`
    // leaves the store and the frame showing different things and the panel is
    // the only place that can say so — but never for a `hello`, whose refusal
    // carries no state and means nothing (spec D7).
    const reportable = !unreported.delete(ack.seq);
    if (reportable && (ack.ok === false || (ack.unknownVmIds?.length ?? 0) > 0)) {
      options.onAckError?.(ack);
    }
    const deferred = pending.get(ack.seq);
    if (!deferred) return;
    settle(ack.seq, deferred);
    deferred.resolve(ack);
  }

  /**
   * The frame only ever runs our own script under `script-src 'self'`, so this
   * is robustness rather than a threat model — but `tag` is rendered into the
   * guard's question and a non-string would throw in React the moment the
   * dialog opened, long after the message that caused it.
   */
  function asElementInfo(payload: unknown): ElementInfo | null {
    const info = payload as Partial<ElementInfo> | null;
    if (!info || typeof info !== "object") return null;
    if (typeof info.vmId !== "string" || typeof info.tag !== "string") return null;
    if (typeof info.textPreview !== "string") return null;
    if (info.role !== null && typeof info.role !== "string") return null;
    if (!isRect(info.rect) || !isRect(info.pageRect)) return null;
    if (typeof info.order !== "number" || typeof info.visible !== "boolean") return null;
    return info as ElementInfo;
  }

  function isRect(value: unknown): boolean {
    const rect = value as Record<string, unknown> | null;
    if (!rect || typeof rect !== "object") return false;
    return (["x", "y", "width", "height"] as const).every(
      (key) => typeof rect[key] === "number" && Number.isFinite(rect[key]),
    );
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
        const info = asElementInfo(data.payload);
        if (!info) return;
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
      const { sent } = send("preview", applied);
      if (sent) previewVmId = vmId;
    },

    // Exactly `clearActivePreview`, early return and all: with nothing up,
    // `preview:clear` is one message per hover-out for a frame-side no-op
    // (`dropPreview` acks `ok: true` having dropped nothing). A `flush` that
    // already ended a masked preview, and `onReady`, both leave it null.
    clearPreview: clearActivePreview,

    replay: (vmId) => {
      // Flush first: a draft change made in this same turn is still sitting in
      // the coalescing frame, and `postMessage` to one window is ordered, so
      // flushing here is enough to guarantee the `apply` arrives before the
      // `replay` — without a round trip.
      if (frameScheduled) flush();
      return post("replay", { vmId });
    },

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

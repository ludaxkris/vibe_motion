"use client";

/**
 * Mounts the framework-free bridge client (`./client.ts`) on the editor's
 * preview iframe.
 *
 * Deliberately thin: everything about the protocol lives in the client, and
 * everything React-shaped lives here — the ref the iframe needs, the `load`
 * handler that re-sends `hello`, the status that has to re-render a banner,
 * and teardown.
 *
 * Why `hello` twice (spec D7): the editor shell is server-rendered, so the
 * iframe starts loading before hydration and the frame's first `ready` can be
 * posted before this listener exists. `hello` on mount covers a frame that
 * loaded early; `hello` on every `load` covers a frame that reloads later.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { env } from "@/lib/env";
import { useEditorStore, type EditorStoreApi } from "@/lib/store";

import { createBridgeClient, type BridgeClient, type BridgeStatus } from "./client";
import type { Unresolved } from "./to-applied";

export type UseBridgeOptions = {
  /** The frame's origin: every inbound message is checked against it, every outbound one targets it. */
  expectedOrigin: string;
  /** Defaults to the module-scope editor store; tests pass their own. */
  store?: EditorStoreApi;
  /** Draft entries whose pinned catalog entry could not be resolved. */
  onUnresolved?: (unresolved: Unresolved[]) => void;
};

export type UseBridgeResult = {
  /** Put this on the preview `<iframe>`. */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  /** Put this on the same iframe's `onLoad`. */
  handleFrameLoad: () => void;
  status: BridgeStatus;
  /** Null until the mount effect has run; the Control Panel's preview and replay go through it. */
  client: BridgeClient | null;
};

declare global {
  interface Window {
    /**
     * Test-only seam for the Playwright performance spec, which has to drive
     * the store and await a quiet channel from outside React. Installed only
     * when `env.apiMocking` is true, which a production build forces off
     * (`lib/env.ts`), so it cannot exist in a deployed app.
     */
    __vmTest?: { store: EditorStoreApi; client: BridgeClient };
  }
}

export function useBridge({ expectedOrigin, store, onUnresolved }: UseBridgeOptions): UseBridgeResult {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const clientRef = useRef<BridgeClient | null>(null);
  const [status, setStatus] = useState<BridgeStatus>("connecting");
  // State as well as a ref: a consumer that renders from the client (the
  // Control Panel's preview and replay) has to re-render when it appears.
  const [client, setClient] = useState<BridgeClient | null>(null);

  // Held in a ref so a caller passing an inline callback cannot tear the
  // channel down and rebuild it on every render. Written in an effect, not
  // during render, so a render React throws away cannot leave it pointing at a
  // callback that was never committed.
  const unresolvedRef = useRef(onUnresolved);
  useEffect(() => {
    unresolvedRef.current = onUnresolved;
  }, [onUnresolved]);

  // A reference to the store object, not a hook call: `useEditorStore` is both.
  const defaultStore: EditorStoreApi = useEditorStore;
  const activeStore = store ?? defaultStore;

  useEffect(() => {
    const created = createBridgeClient({
      target: () => frameRef.current?.contentWindow ?? null,
      expectedOrigin,
      listenOn: window,
      store: activeStore,
      onStatusChange: setStatus,
      onUnresolved: (list) => unresolvedRef.current?.(list),
    });
    clientRef.current = created;
    setClient(created);
    if (env.apiMocking) window.__vmTest = { store: activeStore, client: created };

    // The frame may already be loaded and waiting: the whole point of `hello`.
    created.hello();

    return () => {
      created.destroy();
      clientRef.current = null;
      setClient(null);
      setStatus("connecting");
      if (window.__vmTest?.client === created) delete window.__vmTest;
    };
  }, [expectedOrigin, activeStore]);

  const handleFrameLoad = useCallback(() => {
    clientRef.current?.hello();
  }, []);

  return { frameRef, handleFrameLoad, status, client };
}

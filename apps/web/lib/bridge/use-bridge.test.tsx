import { PROTOCOL_VERSION } from "bridge";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorStore, type EditorStoreHook } from "@/lib/store";

import { useBridge } from "./use-bridge";

const FRAME_ORIGIN = "http://127.0.0.1:3000";
const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_MOCKING;

type Posted = { type: string; payload: unknown; seq?: number };

function Harness({
  store,
  expectedOrigin = FRAME_ORIGIN,
}: {
  store: EditorStoreHook;
  expectedOrigin?: string;
}) {
  const { frameRef, handleFrameLoad, status } = useBridge({ expectedOrigin, store });
  return (
    <>
      <iframe title="Cloned page preview" ref={frameRef} onLoad={handleFrameLoad} />
      <span data-testid="status">{status}</span>
    </>
  );
}

/**
 * Mounts the hook on a real jsdom iframe. `contentWindow.postMessage` is
 * spied rather than left to jsdom, so a test sees exactly what the shell sent
 * and to which origin — and so the real cross-origin post (which jsdom refuses
 * for an `about:blank` frame) never runs.
 */
function mount(options: { expectedOrigin?: string } = {}) {
  const store = createEditorStore();
  const posted: Array<{ data: Posted; targetOrigin: string }> = [];

  const view = render(<Harness store={store} expectedOrigin={options.expectedOrigin} />);
  const frame = screen.getByTitle("Cloned page preview") as HTMLIFrameElement;
  const contentWindow = frame.contentWindow;
  if (!contentWindow) throw new Error("jsdom gave the iframe no browsing context");

  vi.spyOn(contentWindow, "postMessage").mockImplementation(((
    data: unknown,
    targetOrigin: string,
  ) => {
    posted.push({ data: data as Posted, targetOrigin });
  }) as Window["postMessage"]);

  return {
    store,
    posted,
    frame,
    view,
    /** A message from the frame, with a real `source` jsdom will accept. */
    deliver(type: string, payload: unknown, origin = options.expectedOrigin ?? FRAME_ORIGIN) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "vibe-motion", type, payload },
            origin,
            source: contentWindow,
          }),
        );
      });
    },
    types: () => posted.map((entry) => entry.data.type),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__vmTest;
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_API_MOCKING;
  else process.env.NEXT_PUBLIC_API_MOCKING = ORIGINAL_ENV;
});

describe("useBridge", () => {
  it("says hello on mount, to the frame's origin and never to a wildcard", () => {
    const { posted } = mount();

    // The spy is installed after the first render, so the mount `hello` is
    // replayed by the `load` the browser fires for every iframe; assert the
    // handshake goes out at all, and with the right target origin.
    act(() => {
      screen.getByTitle("Cloned page preview").dispatchEvent(new Event("load"));
    });

    expect(posted.map((entry) => entry.data.type)).toContain("hello");
    expect(posted.every((entry) => entry.targetOrigin === FRAME_ORIGIN)).toBe(true);
    expect(posted.some((entry) => entry.targetOrigin === "*")).toBe(false);
  });

  it("says hello again on every iframe load, because the first ready can precede hydration", () => {
    const harness = mount();
    const frame = harness.frame;

    act(() => {
      frame.dispatchEvent(new Event("load"));
    });
    act(() => {
      frame.dispatchEvent(new Event("load"));
    });

    expect(harness.types().filter((type) => type === "hello")).toHaveLength(2);
  });

  it("re-renders with the status the client reports", () => {
    const harness = mount();
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");

    harness.deliver("ready", {
      elementCount: 3,
      bridgeVersion: "1.0.0",
      protocolVersion: PROTOCOL_VERSION,
    });

    expect(screen.getByTestId("status")).toHaveTextContent("ready");
  });

  it("goes to version-mismatch on a protocol this build does not know", () => {
    const harness = mount();

    harness.deliver("ready", {
      elementCount: 3,
      bridgeVersion: "9.0.0",
      protocolVersion: PROTOCOL_VERSION + 1,
    });

    expect(screen.getByTestId("status")).toHaveTextContent("version-mismatch");
    // Spec D7: from then on the shell says nothing at all.
    const before = harness.posted.length;
    act(() => {
      harness.frame.dispatchEvent(new Event("load"));
    });
    expect(harness.posted).toHaveLength(before);
  });

  it("ignores a message from another origin", () => {
    const harness = mount();

    harness.deliver(
      "ready",
      { elementCount: 3, bridgeVersion: "1.0.0", protocolVersion: PROTOCOL_VERSION },
      "http://evil.test",
    );

    expect(screen.getByTestId("status")).toHaveTextContent("connecting");
  });

  it("destroys the client on unmount, so a late ready reaches nothing", () => {
    const harness = mount();
    harness.view.unmount();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "vibe-motion",
            type: "element:select",
            payload: {
              vmId: "vm-1",
              tag: "h1",
              role: null,
              textPreview: "",
              rect: { x: 0, y: 0, width: 1, height: 1 },
              pageRect: { x: 0, y: 0, width: 1, height: 1 },
              order: 0,
              visible: true,
            },
          },
          origin: FRAME_ORIGIN,
          source: harness.frame.contentWindow,
        }),
      );
    });

    expect(harness.store.getState().elements).toEqual({});
  });

  it("exposes the test-only hook when mocking is enabled, and takes it away on unmount", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { useBridge: mocking } = await import("./use-bridge");
    const store = createEditorStore();

    function MockHarness() {
      const { frameRef, handleFrameLoad } = mocking({ expectedOrigin: FRAME_ORIGIN, store });
      return <iframe title="Cloned page preview" ref={frameRef} onLoad={handleFrameLoad} />;
    }

    const view = render(<MockHarness />);
    expect(window.__vmTest?.store).toBe(store);
    expect(typeof window.__vmTest?.client.replay).toBe("function");

    view.unmount();
    expect(window.__vmTest).toBeUndefined();
  });

  it("leaves no test hook on the window when mocking is off", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;
    const { useBridge: real } = await import("./use-bridge");
    const store = createEditorStore();

    function RealHarness() {
      const { frameRef } = real({ expectedOrigin: FRAME_ORIGIN, store });
      return <iframe title="Cloned page preview" ref={frameRef} />;
    }

    render(<RealHarness />);

    expect(window.__vmTest).toBeUndefined();
  });
});

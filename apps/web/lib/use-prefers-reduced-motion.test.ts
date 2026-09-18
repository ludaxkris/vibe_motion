import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

type Listener = (event: { matches: boolean }) => void;

/** A minimal `matchMedia` whose match can be flipped from the test. */
function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  let matches = initialMatches;
  const removeEventListener = vi.fn((_: string, listener: Listener) => {
    listeners.delete(listener);
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: Listener) => listeners.add(listener),
      removeEventListener,
    })),
  );
  return {
    removeEventListener,
    change: (next: boolean) => {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("is false when the user has expressed no preference", () => {
    stubMatchMedia(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it("is true when the user asks for reduced motion", () => {
    stubMatchMedia(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
  });

  it("follows the preference changing while the page is open", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());

    act(() => media.change(true));

    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const media = stubMatchMedia(false);
    renderHook(() => usePrefersReducedMotion()).unmount();

    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it("assumes no preference where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });
});

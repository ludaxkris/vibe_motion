import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION_MS, Toaster, useToastStore } from "./toast";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => useToastStore.getState().dismiss());
  });

  function show(message: string) {
    act(() => useToastStore.getState().show(message));
  }

  it("keeps a live region mounted so the message is announced", () => {
    render(<Toaster />);

    const live = screen.getByRole("status");
    expect(live).toBeEmptyDOMElement();
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("shows the message as a bottom-centre ink pill", () => {
    render(<Toaster />);

    show("Saved v6");

    expect(screen.getByRole("status")).toHaveTextContent("Saved v6");
    const pill = screen.getByText("Saved v6");
    expect(pill).toHaveClass("bg-vm-ink", "text-vm-ink-inverse", "rounded-pill");
    // One line, however long the message: the handoff's pill never wraps.
    expect(pill).toHaveClass("whitespace-nowrap");
  });

  it("slides up 8px over 250ms", () => {
    render(<Toaster />);

    show("Copied CSS");

    expect(screen.getByText("Copied CSS")).toHaveClass(
      "animate-in",
      "slide-in-from-bottom-2",
      "duration-(--dur-base)",
    );
  });

  it("auto-dismisses after ~2s", () => {
    render(<Toaster />);

    show("Saved v6");
    expect(screen.getByRole("status")).toHaveTextContent("Saved v6");

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved v6");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("restarts the timer when a second toast replaces the first", () => {
    render(<Toaster />);

    show("Saved v6");
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
    });
    show("Copied CSS");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied CSS");

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("never reuses an id, so a dismiss and a show in one batch still replay", () => {
    render(<Toaster />);

    show("Saved v6");
    const first = useToastStore.getState().current?.id;

    // A Phase 6 Save clearing one confirmation and raising another lands both
    // in a single React batch: same `key` would mean React reuses the element
    // and the entrance never plays again.
    act(() => {
      useToastStore.getState().dismiss();
      useToastStore.getState().show("Saved v7");
    });
    const second = useToastStore.getState().current?.id;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(screen.getByRole("status")).toHaveTextContent("Saved v7");
  });

  it("can be dismissed before the timer fires", () => {
    render(<Toaster />);

    show("Saved v6");
    act(() => useToastStore.getState().dismiss());

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

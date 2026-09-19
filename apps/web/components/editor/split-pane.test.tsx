import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SplitPane } from "./split-pane";

const STORAGE_KEY = "vm-panel-width";

function renderSplitPane() {
  return render(<SplitPane left={<div>left pane</div>} right={<div>right pane</div>} />);
}

function separator() {
  return screen.getByRole("separator", { name: "Resize Control Panel" });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * jsdom has no layout, so a drag needs a container box to measure against:
 * 1000px wide, right edge at 1000, which makes `clientX` read straight off as
 * "100 − panel %".
 */
function stubContainerBox() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    bottom: 0,
    left: 0,
    right: 1000,
    width: 1000,
    height: 100,
    toJSON: () => ({}),
  });
}

describe("SplitPane", () => {
  it("renders both panes", () => {
    renderSplitPane();

    expect(screen.getByText("left pane")).toBeInTheDocument();
    expect(screen.getByText("right pane")).toBeInTheDocument();
  });

  it("draws as the panel's 1px border, with a wider invisible hit area", () => {
    renderSplitPane();

    const handle = separator();
    expect(handle).toHaveClass("w-px", "bg-vm-border");
    // The grabbable strip is a pseudo-element, so the hairline stays a hairline.
    expect(handle.className).toContain("after:-left-1");
    expect(handle.className).toContain("after:-right-1");
  });

  // APG's window-splitter pattern: the value describes the PRIMARY pane — the
  // preview, on the left — not the panel the drag is sized against. So the
  // default 25% panel reads as a 75% preview, in [70, 80].
  it("describes the preview pane, per the window-splitter pattern", () => {
    renderSplitPane();

    const handle = separator();
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuemin", "70");
    expect(handle).toHaveAttribute("aria-valuemax", "80");
    expect(handle).toHaveAttribute("aria-valuenow", "75");
  });

  it("grows the panel on ArrowLeft and shrinks it on ArrowRight, by 1 each press", () => {
    renderSplitPane();
    const handle = separator();

    // The panel grows to 26, so the preview it is measured against is 74.
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "74");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "76");
  });

  it("clamps keyboard resize at the minimum and maximum", () => {
    renderSplitPane();
    const handle = separator();

    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(handle, { key: "ArrowRight" });
    }
    expect(handle).toHaveAttribute("aria-valuenow", "80");

    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
    }
    expect(handle).toHaveAttribute("aria-valuenow", "70");
  });

  it("Home widens the panel to its maximum (30) and End shrinks it to its minimum (20)", () => {
    renderSplitPane();
    const handle = separator();

    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyUp(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "70");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("30");

    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyUp(handle, { key: "End" });
    expect(handle).toHaveAttribute("aria-valuenow", "80");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("20");
  });

  it("persists the width to localStorage under vm-panel-width", () => {
    renderSplitPane();
    const handle = separator();

    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyUp(handle, { key: "Home" });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("30");
  });

  it("writes once the key comes back up, not on every auto-repeat", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderSplitPane();
    const handle = separator();

    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
    }
    expect(setItem).not.toHaveBeenCalled();

    fireEvent.keyUp(handle, { key: "ArrowLeft" });

    expect(setItem).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("28");
  });

  it("writes once at the end of a drag, not on every pointermove", () => {
    stubContainerBox();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderSplitPane();
    const handle = separator();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    for (const clientX of [740, 750, 760]) {
      fireEvent.pointerMove(handle, { clientX, pointerId: 1 });
    }

    // The panel follows the pointer live…
    expect(handle).toHaveAttribute("aria-valuenow", "76");
    expect(setItem).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1 });

    // …and the browser is only told about it once the drag is over.
    expect(setItem).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("24");
  });

  it("starts a drag on the primary button only", () => {
    stubContainerBox();
    renderSplitPane();
    const handle = separator();

    // A right-click opens a context menu; it must not also begin a resize that
    // only ends on the next pointerup.
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 760, pointerId: 1 });

    expect(handle).toHaveAttribute("aria-valuenow", "75");
    expect(handle).not.toHaveClass("bg-vm-accent");
  });

  it("suppresses text selection for the length of a drag, and only that long", () => {
    stubContainerBox();
    renderSplitPane();
    const handle = separator();
    // The whole split, so neither pane's text is selected by the sweep.
    const split = handle.parentElement;

    expect(split).not.toHaveClass("select-none");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 760, pointerId: 1 });
    // pointerdown does not preventDefault() (the separator has to be
    // focusable by click), so without this the drag selects panel text.
    expect(split).toHaveClass("select-none");

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(split).not.toHaveClass("select-none");
  });

  it("lets a click focus the separator, the way any other control would", () => {
    renderSplitPane();
    const handle = separator();

    const event = createEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent(handle, event);

    // preventDefault() here would deny the tabIndex={0} handle the focus a
    // click normally gives it.
    expect(event.defaultPrevented).toBe(false);
  });

  it("restores a valid persisted width on mount, clamped to [20, 30]", () => {
    // The key still holds the PANEL percentage; only what the separator
    // announces changed.
    window.localStorage.setItem(STORAGE_KEY, "22");
    renderSplitPane();

    expect(separator()).toHaveAttribute("aria-valuenow", "78");
  });

  it("clamps an out-of-range persisted width on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "80");
    renderSplitPane();

    expect(separator()).toHaveAttribute("aria-valuenow", "70");
  });

  it("ignores an invalid persisted width and falls back to the default", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-number");
    renderSplitPane();

    expect(separator()).toHaveAttribute("aria-valuenow", "75");
  });

  it("sizes the panel pane itself from the stored percentage, not the announced one", () => {
    window.localStorage.setItem(STORAGE_KEY, "22");
    renderSplitPane();

    expect(screen.getByText("right pane").parentElement).toHaveStyle({ width: "22%" });
  });
});

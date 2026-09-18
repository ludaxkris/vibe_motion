import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});

describe("SplitPane", () => {
  it("renders both panes", () => {
    renderSplitPane();

    expect(screen.getByText("left pane")).toBeInTheDocument();
    expect(screen.getByText("right pane")).toBeInTheDocument();
  });

  it("defaults the Control Panel width to 25%, exposed via aria-valuenow", () => {
    renderSplitPane();

    const handle = separator();
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuemin", "20");
    expect(handle).toHaveAttribute("aria-valuemax", "30");
    expect(handle).toHaveAttribute("aria-valuenow", "25");
  });

  it("grows the panel on ArrowLeft and shrinks it on ArrowRight, by 1 each press", () => {
    renderSplitPane();
    const handle = separator();

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "26");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "24");
  });

  it("clamps keyboard resize at the minimum and maximum", () => {
    renderSplitPane();
    const handle = separator();

    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(handle, { key: "ArrowRight" });
    }
    expect(handle).toHaveAttribute("aria-valuenow", "20");

    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
    }
    expect(handle).toHaveAttribute("aria-valuenow", "30");
  });

  it("Home sets the width to the maximum (30) and End to the minimum (20)", () => {
    renderSplitPane();
    const handle = separator();

    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "30");

    fireEvent.keyDown(handle, { key: "End" });
    expect(handle).toHaveAttribute("aria-valuenow", "20");
  });

  it("persists the width to localStorage under vm-panel-width", () => {
    renderSplitPane();
    const handle = separator();

    fireEvent.keyDown(handle, { key: "Home" });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("30");
  });

  it("restores a valid persisted width on mount, clamped to [20, 30]", () => {
    window.localStorage.setItem(STORAGE_KEY, "22");
    renderSplitPane();

    expect(separator()).toHaveAttribute("aria-valuenow", "22");
  });

  it("clamps an out-of-range persisted width on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "80");
    renderSplitPane();

    expect(separator()).toHaveAttribute("aria-valuenow", "30");
  });

  it("ignores an invalid persisted width and falls back to the default", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-number");
    renderSplitPane();

    expect(separator()).toHaveAttribute("aria-valuenow", "25");
  });
});

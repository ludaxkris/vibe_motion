import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AutoResultPanel, type AutoResultProps, type AutoResultRow } from "./auto-result";

const ROWS: AutoResultRow[] = [
  {
    vmId: "vm-3",
    tag: "h1",
    animationName: "Fade In Up",
    trigger: "load",
    duration: "600ms",
    delay: "0ms",
    edited: false,
  },
  {
    vmId: "vm-7",
    tag: "p",
    animationName: "Fade In",
    trigger: "in-view",
    duration: "500ms",
    delay: "60ms",
    edited: true,
  },
  {
    vmId: "vm-9",
    tag: "a",
    animationName: "Pulse",
    trigger: "hover",
    duration: "400ms",
    delay: "0ms",
    edited: false,
  },
];

function renderResult(props: Partial<AutoResultProps> = {}) {
  const handlers = {
    onSelectRow: vi.fn(),
    onRegenerate: vi.fn(),
    onReplayAll: vi.fn(),
    onRemoveAll: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <AutoResultPanel
      rows={ROWS}
      prompt="calm, staggered entrances, nothing loops"
      skippedCount={0}
      truncated={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers };
}

describe("AutoResultPanel", () => {
  it("heads the list with how many animations were generated", () => {
    renderResult();

    expect(screen.getByTestId("panel-auto-result")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("✦ Generated 3 animations");
  });

  it("says '1 animation' for a single row", () => {
    renderResult({ rows: ROWS.slice(0, 1) });

    expect(screen.getByRole("heading")).toHaveTextContent("✦ Generated 1 animation");
    expect(screen.getByRole("heading")).not.toHaveTextContent("animations");
  });

  it("Regenerate calls onRegenerate", () => {
    const { onRegenerate } = renderResult();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("quotes the prompt", () => {
    renderResult();

    expect(screen.getByTestId("auto-result-prompt")).toHaveTextContent(
      "“calm, staggered entrances, nothing loops”",
    );
  });

  it("has no quote block when the prompt is empty", () => {
    renderResult({ prompt: "" });
    expect(screen.queryByTestId("auto-result-prompt")).not.toBeInTheDocument();
  });

  it("has no quote block when the prompt is only whitespace", () => {
    renderResult({ prompt: "  \n" });
    expect(screen.queryByTestId("auto-result-prompt")).not.toBeInTheDocument();
  });

  it("lists one row per entry, reading tag · name · trigger · duration · delay", () => {
    renderResult();

    const rows = screen.getAllByTestId("auto-result-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("h1");
    expect(rows[0]).toHaveTextContent("Fade In Up");
    expect(rows[0]).toHaveTextContent("load · 600ms · 0ms");
    expect(rows[2]).toHaveTextContent("hover · 400ms · 0ms");
  });

  it("tags an edited row, quietly, and leaves the others alone", () => {
    renderResult();

    const rows = screen.getAllByTestId("auto-result-row");
    expect(within(rows[1]).getByText("edited")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("edited")).not.toBeInTheDocument();
    expect(within(rows[2]).queryByText("edited")).not.toBeInTheDocument();
  });

  it("clicking a row selects its element", () => {
    const { onSelectRow } = renderResult();

    fireEvent.click(screen.getAllByTestId("auto-result-row")[1]);

    expect(onSelectRow).toHaveBeenCalledExactlyOnceWith("vm-7");
  });

  it("a row is a button, so Enter on it selects its element too", () => {
    const { onSelectRow } = renderResult();
    const row = screen.getAllByTestId("auto-result-row")[0];

    // A native <button> turns Enter into a click; jsdom does not synthesise
    // that, so assert the element type and fire what the browser would.
    expect(row.tagName).toBe("BUTTON");
    row.focus();
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.click(row);

    expect(onSelectRow).toHaveBeenCalledExactlyOnceWith("vm-3");
  });

  it("captions the list with how to tune", () => {
    renderResult();

    const caption = screen.getByTestId("auto-result-caption");
    expect(caption).toHaveTextContent(
      "Click a row to tune it, or click the element on the page.",
    );
    expect(caption).not.toHaveTextContent("Skipped");
    expect(caption).not.toHaveTextContent("Only the first");
  });

  it("says how many elements were skipped", () => {
    renderResult({ skippedCount: 4 });

    expect(screen.getByTestId("auto-result-caption")).toHaveTextContent(
      "Skipped 4 elements (too small, hidden or not content).",
    );
  });

  it("says '1 element' for a single skip", () => {
    renderResult({ skippedCount: 1 });

    expect(screen.getByTestId("auto-result-caption")).toHaveTextContent(
      "Skipped 1 element (too small, hidden or not content).",
    );
  });

  it("says when the page was truncated", () => {
    renderResult({ truncated: true });

    expect(screen.getByTestId("auto-result-caption")).toHaveTextContent(
      "Only the first 200 elements were considered.",
    );
  });

  it("Replay all calls onReplayAll", () => {
    const { onReplayAll } = renderResult();

    fireEvent.click(screen.getByRole("button", { name: "Replay all" }));

    expect(onReplayAll).toHaveBeenCalledOnce();
  });

  it("Replay all is disabled when replayDisabled", () => {
    renderResult({ replayDisabled: true });

    expect(screen.getByRole("button", { name: "Replay all" })).toBeDisabled();
  });

  it("Remove all calls onRemoveAll", () => {
    const { onRemoveAll } = renderResult();

    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));

    expect(onRemoveAll).toHaveBeenCalledOnce();
  });

  it("‹ calls onClose", () => {
    const { onClose } = renderResult();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

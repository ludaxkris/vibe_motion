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
      consideredLimit={200}
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
    expect(screen.getByTestId("auto-result-title")).toHaveTextContent("✦ Generated 3 animations");
  });

  it("says '1 animation' for a single row", () => {
    renderResult({ rows: ROWS.slice(0, 1) });

    expect(screen.getByTestId("auto-result-title")).toHaveTextContent("✦ Generated 1 animation");
    expect(screen.getByTestId("auto-result-title")).not.toHaveTextContent("animations");
  });

  it("titles the panel the way tuning and choosing do, not with a heading element", () => {
    renderResult();

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
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

  it("a row is a native button, so it is keyboard-activatable without a key handler", () => {
    renderResult();
    const row = screen.getAllByTestId("auto-result-row")[0];

    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAttribute("type", "button");
    row.focus();
    expect(row).toHaveFocus();
  });

  it("names each row by animation, tag and vmId, so same-tag rows read apart", () => {
    renderResult();

    expect(screen.getByRole("button", { name: "Tune Fade In Up on h1 (vm-3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tune Fade In on p (vm-7)" })).toBeInTheDocument();
  });

  it("leaves no empty segment in the meta when a timing is missing", () => {
    renderResult({ rows: [{ ...ROWS[0], duration: "", delay: "" }, { ...ROWS[1], duration: "" }] });

    const metas = screen.getAllByTestId("auto-result-row-meta");
    expect(metas[0].textContent).toBe("load");
    expect(metas[1].textContent).toBe("in-view · 60ms");
  });

  it("lets a long tag widen its chip rather than clipping it", () => {
    renderResult({ rows: [{ ...ROWS[0], tag: "blockquote" }] });

    const chip = screen.getByText("blockquote");
    expect(chip).toHaveClass("min-w-[58px]", "text-center");
    expect(chip).not.toHaveClass("truncate");
  });

  describe("with no rows left", () => {
    it("says so instead of rendering an empty list", () => {
      renderResult({ rows: [] });

      expect(screen.getByText("No generated animations left.")).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryByTestId("auto-result-caption")).not.toBeInTheDocument();
    });

    it("still offers Regenerate and the way out", () => {
      const { onRegenerate, onClose } = renderResult({ rows: [] });

      fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(onRegenerate).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("has nothing to replay or remove", () => {
      renderResult({ rows: [] });

      expect(screen.queryByRole("button", { name: "Replay all" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove all" })).not.toBeInTheDocument();
    });
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

  it("states the limit the query actually used", () => {
    renderResult({ truncated: true, consideredLimit: 500 });

    expect(screen.getByTestId("auto-result-caption")).toHaveTextContent(
      "Only the first 500 elements were considered.",
    );
  });

  it("Regenerate is disabled when regenerateDisabled", () => {
    const { onRegenerate } = renderResult({ regenerateDisabled: true });

    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    expect(regenerate).toBeDisabled();
    fireEvent.click(regenerate);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("Remove all is disabled when removeAllDisabled", () => {
    const { onRemoveAll } = renderResult({ removeAllDisabled: true });

    const removeAll = screen.getByRole("button", { name: "Remove all" });
    expect(removeAll).toBeDisabled();
    fireEvent.click(removeAll);
    expect(onRemoveAll).not.toHaveBeenCalled();
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

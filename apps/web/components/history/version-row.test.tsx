import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Version } from "@/lib/api-client";
import type { DiffRow } from "@/lib/diff-summary";

import { VersionRow } from "./version-row";

const NOW = new Date("2026-09-18T12:00:00.000Z");

function version(overrides: Partial<Version> = {}): Version {
  return {
    id: "v5-id",
    projectId: "project-1",
    parentVersionId: "v4-id",
    seq: 5,
    label: "Pulse on .cta",
    catalogVersion: "1.1.0",
    diff: { set: {}, remove: [] },
    createdAt: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

const ROWS: DiffRow[] = [
  { kind: "added", sign: "+", vmId: "h1", name: "Fade In Up", meta: "600ms · ease-out · 24px" },
];

function callbacks() {
  return { onView: vi.fn(), onRestore: vi.fn() };
}

describe("VersionRow", () => {
  it("renders the version label, its own label and a Current badge", () => {
    render(
      <VersionRow
        version={version()}
        rows={[]}
        isCurrent
        isViewing={false}
        now={NOW}
        {...callbacks()}
      />,
    );

    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("Pulse on .cta")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("omits the Current badge otherwise", () => {
    render(
      <VersionRow
        version={version()}
        rows={[]}
        isCurrent={false}
        isViewing={false}
        now={NOW}
        {...callbacks()}
      />,
    );

    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });

  it("calls onView with the version's id when clicked", () => {
    const handlers = callbacks();
    render(
      <VersionRow
        version={version()}
        rows={[]}
        isCurrent={false}
        isViewing={false}
        now={NOW}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^v5/ }));
    expect(handlers.onView).toHaveBeenCalledWith("v5-id");
  });

  it("expands with diff rows, a Restore button and a disabled Export when viewing", () => {
    const handlers = callbacks();
    render(
      <VersionRow
        version={version()}
        rows={ROWS}
        isCurrent={false}
        isViewing
        now={NOW}
        {...handlers}
      />,
    );

    expect(screen.getByRole("button", { name: /^v5/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("+")).toBeInTheDocument();
    expect(screen.getByText("Added")).toHaveClass("sr-only");
    expect(screen.getByText("Fade In Up")).toBeInTheDocument();

    const restore = screen.getByRole("button", { name: "Restore" });
    fireEvent.click(restore);
    expect(handlers.onRestore).toHaveBeenCalledWith("v5-id");
    // Restore lives outside the header row, so clicking it must not also view.
    expect(handlers.onView).not.toHaveBeenCalled();

    const exportButton = screen.getByRole("button", { name: "Export v5" });
    expect(exportButton).toBeDisabled();
  });

  it("enables Export once a handler is supplied", () => {
    render(
      <VersionRow
        version={version()}
        rows={[]}
        isCurrent={false}
        isViewing
        now={NOW}
        onExport={vi.fn()}
        {...callbacks()}
      />,
    );

    expect(screen.getByRole("button", { name: "Export v5" })).toBeEnabled();
  });

  it("shows no Restore button on the current version's expanded row", () => {
    render(
      <VersionRow version={version()} rows={[]} isCurrent isViewing now={NOW} {...callbacks()} />,
    );

    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("shows the cloned element count for v0", () => {
    render(
      <VersionRow
        version={version({ id: "v0-id", seq: 0, parentVersionId: null, label: "Cloned" })}
        rows={[]}
        isCurrent={false}
        isViewing={false}
        now={NOW}
        elementCount={42}
        {...callbacks()}
      />,
    );

    expect(screen.getByText(/42 elements/)).toBeInTheDocument();
  });

  it("keeps the cloned element count for v0 when it is also the current version", () => {
    render(
      <VersionRow
        version={version({ id: "v0-id", seq: 0, parentVersionId: null, label: "Cloned" })}
        rows={[]}
        isCurrent
        isViewing={false}
        now={NOW}
        elementCount={42}
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Current · 2h ago · 42 elements")).toBeInTheDocument();
  });

  it("points aria-controls at the expanded region's own id", () => {
    render(
      <VersionRow
        version={version()}
        rows={ROWS}
        isCurrent={false}
        isViewing
        now={NOW}
        {...callbacks()}
      />,
    );

    const button = screen.getByRole("button", { name: /^v5/ });
    const controlsId = button.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).not.toBeNull();
  });

  it("disables the row itself while restoring, rather than swallowing the click", () => {
    const handlers = callbacks();
    render(
      <VersionRow
        version={version()}
        rows={[]}
        isCurrent={false}
        isViewing={false}
        now={NOW}
        restoring
        {...handlers}
      />,
    );

    // The hook refuses a view while a restore is in flight (it would land on
    // top of the version the restore creates), so the row must not look live.
    const view = screen.getByRole("button", { name: /^v5/ });
    expect(view).toBeDisabled();
    fireEvent.click(view);
    expect(handlers.onView).not.toHaveBeenCalled();
  });

  it("disables Restore while restoring", () => {
    render(
      <VersionRow
        version={version()}
        rows={[]}
        isCurrent={false}
        isViewing
        now={NOW}
        restoring
        {...callbacks()}
      />,
    );

    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
  });
});

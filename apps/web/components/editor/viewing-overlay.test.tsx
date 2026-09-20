import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VersionHistory } from "@/components/history/use-version-history";

import { ViewingOverlay } from "./viewing-overlay";

/** A history in the one state the overlay cares about, unless told otherwise. */
function historyStub(overrides: Partial<VersionHistory> = {}): VersionHistory {
  return {
    versions: [],
    pending: false,
    listError: false,
    retry: () => undefined,
    currentVersionId: "current-id",
    viewingVersionId: "viewed-id",
    viewing: true,
    viewingLabel: "v3",
    currentLabel: "v5",
    nextLabel: "v6",
    error: null,
    restoring: false,
    view: async () => undefined,
    back: () => undefined,
    restore: async () => undefined,
    ...overrides,
  };
}

describe("ViewingOverlay", () => {
  it("renders nothing while the editor is editing", () => {
    const { container } = render(
      <ViewingOverlay history={historyStub({ viewing: false, viewingVersionId: null })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("dims the preview and names the version on screen, the way back and the way forward", () => {
    render(<ViewingOverlay history={historyStub()} />);

    expect(screen.getByText("Viewing v3 · read-only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore as v6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to v5" })).toBeInTheDocument();
    // "Preview dims (white 45% overlay)" — the handoff's "History tab".
    expect(screen.getByTestId("viewing-overlay")).toHaveClass("bg-vm-surface/45");
  });

  it("goes back, and restores the version it is showing", () => {
    const back = vi.fn();
    const restore = vi.fn();
    render(<ViewingOverlay history={historyStub({ back, restore })} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to v5" }));
    expect(back).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Restore as v6" }));
    // The viewed version, never the current one: Restore reproduces what is
    // on screen.
    expect(restore).toHaveBeenCalledWith("viewed-id");
  });

  it("holds both buttons while a restore is in flight", () => {
    render(<ViewingOverlay history={historyStub({ restoring: true })} />);

    expect(screen.getByRole("button", { name: "Restore as v6" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to v5" })).toBeDisabled();
  });

  it("waits for the labels rather than showing a banner it cannot name", () => {
    const { container } = render(
      <ViewingOverlay history={historyStub({ viewingLabel: undefined })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

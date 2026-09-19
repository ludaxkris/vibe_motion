import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Version } from "@/lib/api-client";
import { UNSAVED_GUARD_DIALOG_WIDTH } from "@/components/dialogs/unsaved-guard-dialog";

import { ConflictDialog, ConflictDialogContent } from "./conflict-dialog";

const THEIRS: Version = {
  id: "v6-id",
  projectId: "project-1",
  parentVersionId: "v5-id",
  seq: 6,
  label: "Pulse on .cta",
  catalogVersion: "1.1.0",
  diff: { set: {}, remove: [] },
  createdAt: "2026-09-18T09:00:00.000Z",
};

const callbacks = () => ({ onRebase: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() });

describe("ConflictDialogContent", () => {
  it("titles itself after the version that beat this save and names it in the body", () => {
    render(<ConflictDialogContent theirs={THEIRS} {...callbacks()} />);

    expect(screen.getByText("v6 was saved somewhere else")).toBeInTheDocument();
    expect(screen.getByText(/Pulse on \.cta/)).toBeInTheDocument();
  });

  it("puts Discard my changes on the left as a red text link, before the others", () => {
    render(<ConflictDialogContent theirs={THEIRS} {...callbacks()} />);

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Discard my changes", "Keep editing", "Apply my changes on top"]);
    expect(screen.getByRole("button", { name: "Discard my changes" })).toHaveClass(
      "text-vm-danger",
    );
  });

  it("fires each action's own callback", () => {
    const handlers = callbacks();
    render(<ConflictDialogContent theirs={THEIRS} {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard my changes" }));
    expect(handlers.onDiscard).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));
    expect(handlers.onRebase).toHaveBeenCalledOnce();
  });
});

describe("ConflictDialog", () => {
  it("is a 380px modal, the guard dialog's own width, labelled by its title", () => {
    render(<ConflictDialog open theirs={THEIRS} {...callbacks()} />);

    const dialog = screen.getByRole("dialog", { name: "v6 was saved somewhere else" });
    expect(dialog).toHaveClass(UNSAVED_GUARD_DIALOG_WIDTH);
  });

  it("renders nothing while closed", () => {
    render(<ConflictDialog open={false} theirs={THEIRS} {...callbacks()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats dismissing the modal as Keep editing", () => {
    const handlers = callbacks();
    render(<ConflictDialog open theirs={THEIRS} {...handlers} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(handlers.onCancel).toHaveBeenCalled();
    expect(handlers.onDiscard).not.toHaveBeenCalled();
    expect(handlers.onRebase).not.toHaveBeenCalled();
  });
});

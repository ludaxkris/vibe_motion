import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  UnsavedGuardDialog,
  UnsavedGuardDialogContent,
  UNSAVED_GUARD_DIALOG_WIDTH,
} from "./unsaved-guard-dialog";

const callbacks = () => ({ onDiscard: vi.fn(), onKeepEditing: vi.fn() });

describe("UnsavedGuardDialogContent", () => {
  it("names the selected element and the animation that changed", () => {
    render(
      <UnsavedGuardDialogContent
        elementLabel="h1"
        animationName="Fade In Up"
        currentVersionLabel="v5"
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Save changes to h1?")).toBeInTheDocument();
    expect(screen.getByText("Fade In Up")).toBeInTheDocument();
    expect(
      screen.getByText(/but haven’t saved\. Save to keep it as a new version, or discard to leave/),
    ).toHaveTextContent("discard to leave v5 as is.");
  });

  it("falls back to a generic question when nothing is selected", () => {
    render(<UnsavedGuardDialogContent {...callbacks()} />);

    expect(screen.getByText("Save changes?")).toBeInTheDocument();
    expect(screen.getByText(/You have unsaved changes/)).toHaveTextContent(
      "discard to leave the saved version as is.",
    );
  });

  it("counts the elements a discard would revert when it cannot name one", () => {
    // Discard reverts the whole draft, so the copy has to own up to its reach.
    render(
      <UnsavedGuardDialogContent
        unsavedElementCount={2}
        currentVersionLabel="v5"
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Save changes?")).toBeInTheDocument();
    expect(screen.getByText(/You have unsaved changes on 2 elements\./)).toHaveTextContent(
      "discard to leave v5 as is.",
    );
  });

  it("leaves the count out when a single element's changes are all there is", () => {
    render(<UnsavedGuardDialogContent unsavedElementCount={1} {...callbacks()} />);

    expect(screen.getByText(/You have unsaved changes\. Save to keep them/)).toBeInTheDocument();
  });

  it("sets the title at 15/600 and the body in 13px muted ink", () => {
    render(<UnsavedGuardDialogContent elementLabel="h1" {...callbacks()} />);

    expect(screen.getByText("Save changes to h1?")).toHaveClass("text-lg", "font-semibold");
    expect(screen.getByText(/You have unsaved changes/)).toHaveClass("text-md", "text-vm-ink-2");
  });

  it("puts Discard on the left as a red text link, before Keep editing and Save", () => {
    render(<UnsavedGuardDialogContent elementLabel="h1" {...callbacks()} />);

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Discard", "Keep editing", "Save"]);
    expect(screen.getByRole("button", { name: "Discard" })).toHaveClass("text-vm-danger");
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveClass("ml-auto");
  });

  it("fires Discard and Keep editing", () => {
    const handlers = callbacks();
    render(<UnsavedGuardDialogContent elementLabel="h1" {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(handlers.onDiscard).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(handlers.onKeepEditing).toHaveBeenCalledOnce();
  });

  it("leaves Save disabled and says why, rather than faking a save", () => {
    const onSave = vi.fn();
    render(<UnsavedGuardDialogContent elementLabel="h1" onSave={onSave} {...callbacks()} />);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();

    expect(screen.getByText("Saving arrives with version history.")).toHaveClass(
      "text-xs",
      "text-vm-ink-2",
    );
  });

  it("drops the note once Save is live", () => {
    render(<UnsavedGuardDialogContent elementLabel="h1" saveDisabled={false} {...callbacks()} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByText("Saving arrives with version history.")).not.toBeInTheDocument();
  });
});

describe("UnsavedGuardDialog", () => {
  it("is a 380px modal labelled by its question", () => {
    render(<UnsavedGuardDialog open elementLabel="h1" {...callbacks()} />);

    const dialog = screen.getByRole("dialog", { name: "Save changes to h1?" });
    expect(dialog).toHaveClass(UNSAVED_GUARD_DIALOG_WIDTH);
    expect(dialog).toHaveClass("rounded-2xl", "shadow-modal");
  });

  it("renders nothing while closed", () => {
    render(<UnsavedGuardDialog open={false} elementLabel="h1" {...callbacks()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats dismissing the modal as keeping the edit", () => {
    const handlers = callbacks();
    render(<UnsavedGuardDialog open elementLabel="h1" {...handlers} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(handlers.onKeepEditing).toHaveBeenCalled();
    expect(handlers.onDiscard).not.toHaveBeenCalled();
  });
});

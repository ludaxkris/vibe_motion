import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DiffRow } from "@/lib/diff-summary";

import { SaveDialog, SaveDialogContent, SAVE_DIALOG_WIDTH } from "./save-dialog";

const CHANGES: DiffRow[] = [
  {
    kind: "added",
    sign: "+",
    vmId: "vm-3",
    name: "Fade In Up",
    meta: "600ms · ease-out · 24px",
  },
  { kind: "changed", sign: "~", vmId: "vm-7", name: "Pulse", meta: "trigger load → hover" },
  { kind: "removed", sign: "−", vmId: "vm-9", name: "Shake", meta: "" },
];

function props(overrides: Partial<React.ComponentProps<typeof SaveDialogContent>> = {}) {
  return {
    nextVersionLabel: "v6",
    fromVersionLabel: "v5",
    label: "Fade In Up on vm-3",
    onLabelChange: vi.fn(),
    changes: CHANGES,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    // Phase 6 is what turns Save on; every frame that shows a live-looking
    // primary has to say so.
    saveDisabled: false,
    ...overrides,
  };
}

describe("SaveDialogContent", () => {
  it("titles the version it would create and names its parent", () => {
    render(<SaveDialogContent {...props()} />);

    expect(screen.getByText("Save as v6")).toHaveClass("text-lg", "font-semibold");
    expect(screen.getByText("from v5")).toHaveClass("text-sm", "text-vm-ink-2");
  });

  it("prefills the label field from the diff and reports edits", () => {
    const onLabelChange = vi.fn();
    render(<SaveDialogContent {...props({ onLabelChange })} />);

    const field = screen.getByRole("textbox", { name: "Label" });
    expect(field).toHaveValue("Fade In Up on vm-3");

    fireEvent.change(field, { target: { value: "Hero entrance" } });
    expect(onLabelChange).toHaveBeenCalledWith("Hero entrance");
  });

  it("lists every change as sign · tag · name · meta, in the handoff's diff colours", () => {
    render(<SaveDialogContent {...props()} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText("+")).toHaveClass("text-vm-success");
    expect(within(rows[0]).getByText("vm-3")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Fade In Up")).toBeInTheDocument();
    expect(within(rows[0]).getByText("600ms · ease-out · 24px")).toBeInTheDocument();

    expect(within(rows[1]).getByText("~")).toHaveClass("text-vm-warning");
    expect(within(rows[2]).getByText("−")).toHaveClass("text-vm-danger");
  });

  it("says in words what the sign glyph says in colour", () => {
    render(<SaveDialogContent {...props()} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Added");
    expect(rows[1]).toHaveTextContent("Changed");
    expect(rows[2]).toHaveTextContent("Removed");
  });

  it("says so rather than showing an empty list when nothing changed", () => {
    render(<SaveDialogContent {...props({ changes: [] })} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing has changed since the last version.")).toBeInTheDocument();
  });

  it("puts Cancel then Save version on the right and fires both", () => {
    const handlers = { onCancel: vi.fn(), onSave: vi.fn() };
    render(<SaveDialogContent {...props(handlers)} />);

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Cancel", "Save version"]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(handlers.onSave).toHaveBeenCalledOnce();
  });

  it("shows a failed save in place, as an alert, and keeps the dialog usable", () => {
    render(<SaveDialogContent {...props({ error: "Unknown param \"wobble\"" })} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent('Unknown param "wobble"');
    expect(alert).toHaveClass("text-vm-danger");
    // The whole point of an inline error: the user can fix the label and retry.
    expect(screen.getByRole("button", { name: "Save version" })).toBeEnabled();
  });

  it("has no alert line while nothing has failed", () => {
    render(<SaveDialogContent {...props()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses both Save and Cancel while the round trip is in flight", () => {
    render(<SaveDialogContent {...props({ saving: true })} />);

    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    // Cancel too: the POST is already on its way, so there is nothing left to
    // cancel — dismissing here would leave the flow's promise unsettled.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("leaves Save version closed unless the caller opens it", () => {
    const { onLabelChange, onCancel } = props();
    render(
      <SaveDialogContent
        nextVersionLabel="v6"
        label="x"
        onLabelChange={onLabelChange}
        changes={CHANGES}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
  });
});

describe("SaveDialog", () => {
  it("is a 420px modal labelled by its title, with the label field focused", async () => {
    render(<SaveDialog open {...props()} />);

    const dialog = screen.getByRole("dialog", { name: "Save as v6" });
    expect(dialog).toHaveClass(SAVE_DIALOG_WIDTH);
    // Base UI moves initial focus after the open transition, not during render.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Label" })).toHaveFocus(),
    );
  });

  it("renders nothing while closed", () => {
    render(<SaveDialog open={false} {...props()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats dismissing the modal as Cancel", () => {
    const onCancel = vi.fn();
    render(<SaveDialog open {...props({ onCancel })} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onCancel).toHaveBeenCalled();
  });
});

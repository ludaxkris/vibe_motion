import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

function renderGuard() {
  return render(
    <Dialog open>
      <DialogContent className="w-[380px]">
        <DialogHeader>
          <DialogTitle>Save changes to h1?</DialogTitle>
          <DialogDescription>
            You changed Fade In Up on this element but haven&apos;t saved.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("is a labelled modal", () => {
    renderGuard();

    expect(screen.getByRole("dialog", { name: "Save changes to h1?" })).toBeInTheDocument();
  });

  it("is a 14px white card on the modal shadow", () => {
    renderGuard();

    const content = screen.getByRole("dialog");
    expect(content).toHaveClass("rounded-2xl", "bg-vm-surface", "shadow-modal");
  });

  it("sets the title at 15px semibold and the body in muted ink", () => {
    renderGuard();

    expect(screen.getByText("Save changes to h1?")).toHaveClass("text-lg", "font-semibold");
    expect(screen.getByText(/You changed Fade In Up/)).toHaveClass("text-md", "text-vm-ink-2");
  });

  it("drops the scrim in the handoff's violet ink", () => {
    renderGuard();

    expect(document.querySelector("[data-slot='dialog-overlay']")).toHaveClass("bg-vm-scrim");
  });
});

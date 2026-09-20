import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ViewingBanner } from "./viewing-banner";

function callbacks() {
  return { onRestore: vi.fn(), onBack: vi.fn() };
}

describe("ViewingBanner", () => {
  it("reads 'Viewing v3 · read-only'", () => {
    render(
      <ViewingBanner
        viewingLabel="v3"
        currentLabel="v5"
        nextLabel="v6"
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Viewing v3 · read-only")).toBeInTheDocument();
  });

  it("fires onRestore and onBack from their buttons", () => {
    const handlers = callbacks();
    render(
      <ViewingBanner viewingLabel="v3" currentLabel="v5" nextLabel="v6" {...handlers} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore as v6" }));
    expect(handlers.onRestore).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Back to v5" }));
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  it("disables both buttons while restoring", () => {
    render(
      <ViewingBanner
        viewingLabel="v3"
        currentLabel="v5"
        nextLabel="v6"
        restoring
        {...callbacks()}
      />,
    );

    expect(screen.getByRole("button", { name: "Restore as v6" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to v5" })).toBeDisabled();
  });
});

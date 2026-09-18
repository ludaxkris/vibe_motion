import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./input";

/** The visual box is the wrapper; the `<input>` inside it is borderless. */
function boxOf(input: HTMLElement): HTMLElement {
  const box = input.closest("[data-slot='input-wrapper']");
  if (!(box instanceof HTMLElement)) throw new Error("input has no wrapper");
  return box;
}

describe("Input", () => {
  it("stays associated with an external label", () => {
    render(
      <>
        <label htmlFor="page-url">Page URL</label>
        <Input id="page-url" />
      </>,
    );

    expect(screen.getByLabelText("Page URL")).toHaveAttribute("data-slot", "input");
  });

  it("reports typing", () => {
    const onChange = vi.fn();
    render(<Input aria-label="Search animations" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Search animations"), {
      target: { value: "fade" },
    });

    expect(onChange).toHaveBeenCalled();
  });

  it("renders the prefix slot, hidden from screen readers", () => {
    render(<Input aria-label="Page URL" prefix="https://" />);

    const prefix = boxOf(screen.getByLabelText("Page URL")).querySelector(
      "[data-slot='input-prefix']",
    );
    expect(prefix).toHaveTextContent("https://");
    expect(prefix).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["sm", "h-[34px]"],
    ["md", "h-[38px]"],
    ["xl", "h-[var(--control-h-xl)]"],
  ] as const)("size %s sets the %s box height", (size, tokenClass) => {
    render(<Input aria-label="Page URL" size={size} />);

    expect(boxOf(screen.getByLabelText("Page URL"))).toHaveClass(tokenClass);
  });

  it("shows the danger border and glow when the value is invalid", () => {
    render(<Input aria-label="Page URL" aria-invalid />);

    const box = boxOf(screen.getByLabelText("Page URL"));
    expect(box.className).toContain("has-aria-invalid:border-vm-danger");
    expect(box.className).toContain("has-aria-invalid:border-[1.5px]");
  });

  it("puts className on the box so callers can size it", () => {
    render(<Input aria-label="Page URL" className="flex-1" />);

    expect(boxOf(screen.getByLabelText("Page URL"))).toHaveClass("flex-1");
  });
});

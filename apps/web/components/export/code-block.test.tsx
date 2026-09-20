import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeBlock } from "./code-block";

describe("CodeBlock", () => {
  it("renders the bundle's text as text, never as markup", () => {
    // The bundle is HTML from a page this app cloned. Rendered as markup on
    // the editor's own origin, this line would run (plan §1.7).
    const payload = '<img src=x onerror="alert(document.domain)">';

    const { container } = render(<CodeBlock code={payload} fileName="index.html" />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("region", { name: "index.html" })).toHaveTextContent(payload);
  });

  it("keeps a `</style>` inside the code from ending anything", () => {
    const payload = "</style><svg onload=alert(1)>";

    const { container } = render(<CodeBlock code={payload} fileName="vibe-motion.css" />);

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("region", { name: "vibe-motion.css" }).textContent).toBe(payload);
  });

  it("is a named, focusable scroll container", () => {
    render(<CodeBlock code=".vm-a1 {}" fileName="vibe-motion.css" />);

    const region = screen.getByRole("region", { name: "vibe-motion.css" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-auto");
    // Whitespace is the structure of the code: it must not be collapsed.
    expect(region).toHaveClass("whitespace-pre");
  });

  it("offers the Copy pill only when there is somewhere to copy to", () => {
    const onCopy = vi.fn();
    const { rerender } = render(
      <CodeBlock code=".vm-a1 {}" fileName="vibe-motion.css" onCopy={onCopy} />,
    );

    const copy = screen.getByRole("button", { name: "Copy vibe-motion.css" });
    expect(copy).toHaveTextContent("Copy");
    copy.click();
    expect(onCopy).toHaveBeenCalledOnce();

    rerender(<CodeBlock code=".vm-a1 {}" fileName="vibe-motion.css" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("wears the handoff's ink block", () => {
    const { container } = render(<CodeBlock code="x" fileName="f.css" />);

    const block = container.querySelector("[data-slot='export-code-block']");
    // #1d1d1f, and square where it meets the active file tab.
    expect(block).toHaveClass("bg-vm-ink", "rounded-md", "rounded-tl-none");
    expect(screen.getByRole("region", { name: "f.css" })).toHaveClass(
      "font-mono",
      "text-[10.5px]",
      "text-[#d4d4d8]",
    );
  });
});

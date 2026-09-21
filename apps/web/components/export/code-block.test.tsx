import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CODE_PREVIEW_LIMIT, CodeBlock, formatCodeSize } from "./code-block";

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

  describe("a file too big to put in the DOM", () => {
    // Lengths are compared as numbers throughout: a failed assertion on a
    // 1.4 MB string is a 1.4 MB character-by-character diff, which takes the
    // whole worker out with it.
    it("shows the first 200 KB and says so", () => {
      const code = "a".repeat(CODE_PREVIEW_LIMIT * 7);

      render(<CodeBlock code={code} fileName="index.html" />);

      const region = screen.getByRole("region", { name: "index.html" });
      expect(region.textContent?.length).toBe(CODE_PREVIEW_LIMIT);
      expect(screen.getByTestId("code-block-truncated").textContent).toBe(
        "Showing the first 200 KB of 1.4 MB. Copy and Download include the whole file.",
      );
    });

    it("says nothing at all about a file that fits", () => {
      render(<CodeBlock code={"a".repeat(CODE_PREVIEW_LIMIT)} fileName="index.html" />);

      expect(screen.queryByTestId("code-block-truncated")).not.toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "index.html" }).textContent?.length,
      ).toBe(CODE_PREVIEW_LIMIT);
    });
  });

  describe("formatCodeSize", () => {
    it("reads as a size a person would say", () => {
      expect(formatCodeSize(200 * 1024)).toBe("200 KB");
      expect(formatCodeSize(1536)).toBe("2 KB");
      expect(formatCodeSize(1024 * 1024)).toBe("1.0 MB");
      expect(formatCodeSize(10 * 1024 * 1024)).toBe("10.0 MB");
    });
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

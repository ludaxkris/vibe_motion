import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("home page", () => {
  it("renders the URL input", () => {
    render(<Home />);

    const input = screen.getByLabelText("Page URL");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "url");
    expect(input).toHaveAttribute("placeholder", "https://example.com");
  });

  it("keeps submit disabled until cloning is wired up", () => {
    render(<Home />);

    expect(screen.getByRole("button", { name: "Clone page" })).toBeDisabled();
  });

  it("links to the animation catalog", () => {
    render(<Home />);

    expect(
      screen.getByRole("link", { name: "Browse the animation catalog" }),
    ).toHaveAttribute("href", "/help");
  });
});

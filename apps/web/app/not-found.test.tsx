import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

describe("not-found page", () => {
  it("keeps the top bar a banner outside the main landmark", () => {
    render(<NotFound />);

    const banner = screen.getByRole("banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toContainElement(banner);
  });

  it("says what happened and offers the way back", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "That page doesn’t exist.",
    );
    expect(screen.getByRole("link", { name: "Start a new project" })).toHaveAttribute("href", "/");
  });
});

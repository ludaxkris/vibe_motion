import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

/**
 * Padding and the glow are the two places where a variant and a size disagree,
 * so they get their own file rather than crowding `button.test.tsx`.
 */
describe("Button padding", () => {
  it.each(["xs", "sm", "md", "lg"] as const)("size %s keeps the handoff's 14px sides", (size) => {
    render(<Button size={size}>Action</Button>);

    expect(screen.getByRole("button", { name: "Action" })).toHaveClass("px-3.5");
  });

  it("widens to 18px at the 44px size (the entry Clone button)", () => {
    render(
      <Button variant="ink" size="xl">
        Clone
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Clone" })).toHaveClass("px-[18px]");
  });

  it("tightens to 12px on the bar variants", () => {
    render(<Button variant="bar-primary">Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("px-3");
  });

  it("drops the box entirely on the text-link variants", () => {
    render(<Button variant="danger-link">Remove animation</Button>);

    expect(screen.getByRole("button", { name: "Remove animation" })).toHaveClass("px-0", "h-auto");
  });
});

describe("Button glow", () => {
  it("applies to the primary action", () => {
    render(
      <Button variant="primary" glow>
        Save
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("shadow-accent");
  });

  it.each(["secondary", "ink", "bar-primary", "bar-outline", "danger-link", "link"] as const)(
    "is ignored on variant %s — the accent glow is the primary action's alone",
    (variant) => {
      render(
        <Button variant={variant} glow>
          Action
        </Button>,
      );

      expect(screen.getByRole("button", { name: "Action" })).not.toHaveClass("shadow-accent");
    },
  );
});

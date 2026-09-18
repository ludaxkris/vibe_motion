import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IdlePanel } from "./idle";

describe("IdlePanel", () => {
  it("prompts the user to select an element", () => {
    render(<IdlePanel />);
    expect(screen.getByTestId("panel-idle")).toHaveTextContent(/click a component/i);
  });
});

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound }));

describe("/dev/panel", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
  });

  it("renders all four Control Panel states plus a live instance outside production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevPanelPage } = await import("./page");

    render(<DevPanelPage />);

    // Each card's own wrapper testid renders regardless of its children (a
    // card showing TuningPanel's "no draft" fallback would still satisfy a
    // `dev-panel-card-tuning`-only assertion) — assert the panel components'
    // own testids *inside* each card instead, so a stuck fallback fails loudly.
    expect(
      within(screen.getByTestId("dev-panel-card-idle")).getByTestId("panel-idle"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("dev-panel-card-selected")).getByTestId("panel-selected"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("dev-panel-card-choosing")).getByTestId("panel-choosing"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("dev-panel-card-tuning")).getByTestId("panel-tuning"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dev-panel-live-status")).toHaveTextContent("idle");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("calls notFound() in production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevPanelPage } = await import("./page");

    expect(() => DevPanelPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});

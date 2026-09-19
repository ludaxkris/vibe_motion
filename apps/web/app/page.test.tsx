import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<Home />, { wrapper: Wrapper });
}

describe("home page", () => {
  it("renders the handoff's headline and the URL input", () => {
    renderHome();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Animate any page.");
    expect(heading).toHaveTextContent("Paste a URL to clone it.");

    const input = screen.getByLabelText("Page URL");
    expect(input).toBeInTheDocument();
    // The scheme is the field's prefix, so the value is scheme-less and
    // `type="url"` would mark every valid entry invalid.
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "url");
    expect(input).toHaveAttribute("placeholder", "nimbus.app/pricing");
  });

  it("enables the clone button (the form is wired up)", () => {
    renderHome();

    expect(screen.getByRole("button", { name: "Clone" })).toBeEnabled();
  });

  it("links to the animation catalog from the top bar", () => {
    renderHome();

    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  });
});

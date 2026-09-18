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
  it("renders a heading and the URL input", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Add motion to a page" }),
    ).toBeInTheDocument();

    const input = screen.getByLabelText("Page URL");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "url");
    expect(input).toHaveAttribute("placeholder", "https://example.com");
  });

  it("enables the clone button (the form is wired up)", () => {
    renderHome();

    expect(screen.getByRole("button", { name: "Clone page" })).toBeEnabled();
  });

  it("links to the animation catalog", () => {
    renderHome();

    expect(
      screen.getByRole("link", { name: "Browse the animation catalog" }),
    ).toHaveAttribute("href", "/help");
  });
});

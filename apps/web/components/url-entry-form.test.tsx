import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";
import { UNREACHABLE_HOST } from "@/mocks/db";
import { server } from "@/mocks/server";

import { UrlEntryForm } from "./url-entry-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<UrlEntryForm />, { wrapper: Wrapper });
}

const api = (path: string) => `${env.apiOrigin}${path}`;

function typeUrl(value: string) {
  fireEvent.change(screen.getByLabelText("Page URL"), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /clone page/i }));
}

describe("UrlEntryForm", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("pushes to the new project's editor route on success", async () => {
    renderForm();

    typeUrl("https://example.com");
    submit();

    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(1);
    });
    const [destination] = push.mock.calls[0] as [string];
    expect(destination).toMatch(/^\/p\/.+/);
  });

  it("normalises a bare host to an https URL before submitting", async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.post(api("/projects"), async ({ request }) => {
        const body = (await request.json()) as { url: string };
        capturedUrl = body.url;
        return HttpResponse.json(
          {
            id: "proj_1",
            sourceUrl: body.url,
            title: "example.com",
            currentVersionId: "v0",
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderForm();

    typeUrl("example.com");
    submit();

    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(1);
    });
    expect(capturedUrl).toBe("https://example.com/");
  });

  it("rejects invalid input without calling the API", async () => {
    renderForm();

    typeUrl("not a url with spaces!!");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid http/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects empty input without calling the API", async () => {
    renderForm();

    submit();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a human message when the source page cannot be cloned", async () => {
    renderForm();

    typeUrl(`https://${UNREACHABLE_HOST}`);
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not clone/i);
    expect(push).not.toHaveBeenCalled();
    // The form stays filled in so the user can retry.
    expect(screen.getByLabelText("Page URL")).toHaveValue(`https://${UNREACHABLE_HOST}`);
  });

  it("shows a human message on a network failure", async () => {
    server.use(http.post(api("/projects"), () => HttpResponse.error()));

    renderForm();

    typeUrl("https://example.com");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("disables the form and relabels the button while pending", async () => {
    server.use(
      http.post(api("/projects"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    renderForm();

    typeUrl("https://example.com");
    submit();

    expect(await screen.findByRole("button", { name: "Cloning…" })).toBeDisabled();
    expect(screen.getByLabelText("Page URL")).toHaveAttribute("readonly");
  });

  it("shows a hint after 5 seconds of pending", async () => {
    server.use(
      http.post(api("/projects"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderForm();

      typeUrl("https://example.com");
      submit();

      // Flush the microtask (and any zero-delay timers msw schedules) that
      // flips the mutation into its pending state, before advancing the
      // clock to check the slow-clone hint.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("button", { name: "Cloning…" })).toBeInTheDocument();
      expect(screen.queryByText(/still cloning/i)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText(/still cloning/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

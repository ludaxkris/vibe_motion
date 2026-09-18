import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";
import { RECENT_PROJECTS_KEY, readRecentProjects } from "@/lib/recent-projects";
import { CLONE_FAILURE_HOSTS, UNREACHABLE_HOST } from "@/mocks/db";
import { server } from "@/mocks/server";

import { EntryScreen } from "./entry-screen";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<EntryScreen />, { wrapper: Wrapper });
}

const api = (path: string) => `${env.apiOrigin}${path}`;

const field = () => screen.getByLabelText("Page URL");

function typeUrl(value: string) {
  fireEvent.change(field(), { target: { value } });
}

function pasteUrl(value: string) {
  // jsdom does not synthesise the `input` event a paste causes, so the paste is
  // modelled the way the browser delivers it: the field's value, changed.
  fireEvent.change(field(), { target: { value } });
}

function clone() {
  fireEvent.click(screen.getByRole("button", { name: /^(clone|retry)$/i }));
}

function hangingClone() {
  server.use(
    http.post(api("/projects"), async () => {
      await delay("infinite");
      return HttpResponse.json({});
    }),
  );
}

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Chrome and layout
// ---------------------------------------------------------------------------

describe("EntryScreen chrome", () => {
  it("puts the top bar outside the main landmark so it stays a banner", () => {
    renderScreen();

    const banner = screen.getByRole("banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toContainElement(banner);
  });

  it("opens help in a new tab from the bar", () => {
    renderScreen();

    const help = within(screen.getByRole("banner")).getByRole("link", { name: "Help" });
    expect(help).toHaveAttribute("href", "/help");
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders the handoff's two-line headline as the page heading", () => {
    renderScreen();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Animate any page.");
    expect(heading).toHaveTextContent("Paste a URL to clone it.");
  });

  it("lays the body out as the handoff's 1.35fr / 1fr grid", () => {
    renderScreen();

    expect(screen.getByRole("main")).toHaveClass(
      "grid-cols-[1.35fr_1fr]",
      "gap-14",
      "px-[120px]",
      "pt-9",
      "pb-[60px]",
    );
  });
});

// ---------------------------------------------------------------------------
// The URL field: the scheme lives in the prefix
// ---------------------------------------------------------------------------

describe("EntryScreen URL field", () => {
  it("shows the scheme as a decorative prefix, not as part of the value", () => {
    renderScreen();

    const wrapper = field().closest("[data-slot='input-wrapper']");
    const prefix = wrapper?.querySelector("[data-slot='input-prefix']");
    expect(prefix).toHaveTextContent("https://");
    expect(prefix).toHaveAttribute("aria-hidden", "true");
    expect(field()).toHaveValue("");
  });

  it("strips a pasted https:// scheme into the prefix", () => {
    renderScreen();

    pasteUrl("https://nimbus.app/pricing");

    expect(field()).toHaveValue("nimbus.app/pricing");
  });

  it("keeps a typed http:// scheme so plain http stays possible", async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.post(api("/projects"), async ({ request }) => {
        capturedUrl = ((await request.json()) as { url: string }).url;
        return HttpResponse.json(
          {
            id: "proj_1",
            sourceUrl: capturedUrl,
            title: "legacy.test",
            currentVersionId: "v0",
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderScreen();

    typeUrl("http://legacy.test");
    expect(field()).toHaveValue("http://legacy.test");
    clone();

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(capturedUrl).toBe("http://legacy.test/");
  });

  it("normalises a bare host to an https URL before submitting", async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.post(api("/projects"), async ({ request }) => {
        capturedUrl = ((await request.json()) as { url: string }).url;
        return HttpResponse.json(
          {
            id: "proj_1",
            sourceUrl: capturedUrl,
            title: "example.com",
            currentVersionId: "v0",
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderScreen();

    typeUrl("example.com");
    clone();

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(capturedUrl).toBe("https://example.com/");
  });
});

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

describe("EntryScreen cloning", () => {
  it("pushes to the new project's editor route on success", async () => {
    renderScreen();

    typeUrl("example.com");
    clone();

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const [destination] = push.mock.calls[0] as [string];
    expect(destination).toMatch(/^\/p\/.+/);
  });

  it("records the cloned project under Recent projects", async () => {
    renderScreen();

    typeUrl("example.com");
    clone();

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const [remembered] = readRecentProjects();
    expect(remembered?.sourceUrl).toBe("https://example.com/");
    expect(push.mock.calls[0]?.[0]).toBe(`/p/${remembered?.id}`);
  });

  it("disables the clone button and shows the cloning card while the request is open", async () => {
    hangingClone();
    renderScreen();

    typeUrl("example.com");
    clone();

    expect(await screen.findByRole("button", { name: "Clone" })).toBeDisabled();
    const card = screen.getByRole("region", { name: /cloning/i });
    expect(within(card).getByText(/Cloning example\.com/)).toBeInTheDocument();
    expect(field()).toHaveAttribute("readonly");
  });

  it("lists the four clone steps with only the first one active and none complete", async () => {
    hangingClone();
    renderScreen();

    typeUrl("example.com");
    clone();

    const card = await screen.findByRole("region", { name: /cloning/i });
    const steps = within(card).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Fetch page",
      "Inline stylesheets",
      "Sanitise & tag elements",
      "Inject preview bridge",
    ]);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(steps.slice(1).some((step) => step.hasAttribute("aria-current"))).toBe(false);
    // Nothing reports completion: the API sends no progress events.
    expect(within(card).queryByText("✓")).not.toBeInTheDocument();
  });

  it("keeps the progress bar indeterminate", async () => {
    hangingClone();
    renderScreen();

    typeUrl("example.com");
    clone();

    const bar = await screen.findByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("counts the seconds the clone has been running", async () => {
    hangingClone();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderScreen();

    typeUrl("example.com");
    clone();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("· 0 s")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("· 3 s")).toBeInTheDocument();
  });

  it("adds the slow-clone hint to the card's caption after 5 seconds", async () => {
    hangingClone();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderScreen();

    typeUrl("example.com");
    clone();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const card = screen.getByRole("region", { name: /cloning/i });
    expect(within(card).getByText(/Pages over 10 MB/)).toBeInTheDocument();
    expect(within(card).queryByText(/still cloning/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(within(card).getByText(/still cloning/i)).toBeInTheDocument();
  });

  it("dims the recent projects column while cloning", async () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify([
        {
          id: "proj_1",
          title: "nimbus.app/pricing",
          sourceUrl: "https://nimbus.app/pricing",
          openedAt: new Date().toISOString(),
        },
      ]),
    );
    hangingClone();
    renderScreen();

    const column = await screen.findByRole("region", { name: "Recent projects" });
    expect(column).not.toHaveClass("opacity-50");

    typeUrl("example.com");
    clone();

    await waitFor(() => expect(column).toHaveClass("opacity-50"));
  });
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

describe("EntryScreen cancel", () => {
  it("aborts the request, keeps the URL and never navigates", async () => {
    let aborted = false;
    server.use(
      http.post(api("/projects"), async ({ request }) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
        });
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    renderScreen();

    typeUrl("example.com");
    clone();

    const card = await screen.findByRole("region", { name: /cloning/i });
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(aborted).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /cloning/i })).not.toBeInTheDocument(),
    );
    expect(field()).toHaveValue("example.com");
    expect(push).not.toHaveBeenCalled();
  });

  it("does not turn a cancel into an error message", async () => {
    hangingClone();
    renderScreen();

    typeUrl("example.com");
    clone();

    const card = await screen.findByRole("region", { name: /cloning/i });
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Clone" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });
});

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

describe("EntryScreen failures", () => {
  it("rejects invalid input without calling the API", async () => {
    renderScreen();

    typeUrl("not a url with spaces!!");
    clone();

    expect(await screen.findByRole("alert")).toHaveTextContent("That isn’t a valid web address.");
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects empty input without calling the API", async () => {
    renderScreen();

    clone();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not offer the other-reasons card for an address that was never tried", async () => {
    renderScreen();

    typeUrl("not a url with spaces!!");
    clone();

    await screen.findByRole("alert");
    expect(
      screen.queryByRole("region", { name: /other reasons a clone can fail/i }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [CLONE_FAILURE_HOSTS.unreachable, "the site didn’t respond"],
    [CLONE_FAILURE_HOSTS.loginRequired, "it redirected to a sign-in screen"],
    [CLONE_FAILURE_HOSTS.blockedHost, "that host is blocked"],
    [CLONE_FAILURE_HOSTS.notHtml, "isn’t an HTML page"],
    [CLONE_FAILURE_HOSTS.tooLarge, "it’s over 10 MB"],
    [CLONE_FAILURE_HOSTS.rateLimited, "Too many clone requests"],
  ])("explains why %s could not be cloned", async (host, sentence) => {
    renderScreen();

    typeUrl(host);
    clone();

    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the field invalid, keeps the URL and offers a retry", async () => {
    renderScreen();

    typeUrl(UNREACHABLE_HOST);
    clone();

    await screen.findByRole("alert");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveValue(UNREACHABLE_HOST);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("lists the handoff's other reasons a clone can fail", async () => {
    renderScreen();

    typeUrl(UNREACHABLE_HOST);
    clone();

    await screen.findByRole("alert");
    const card = screen.getByRole("region", { name: /other reasons a clone can fail/i });
    for (const term of ["Unreachable", "Too large", "Blocked host", "Not HTML"]) {
      expect(within(card).getByText(term)).toBeInTheDocument();
    }
  });

  it("clears the failure as soon as the URL is edited", async () => {
    renderScreen();

    typeUrl(UNREACHABLE_HOST);
    clone();
    await screen.findByRole("alert");

    typeUrl("example.com");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Clone" })).toBeInTheDocument();
  });

  it("shows a connection message when the request never reaches the API", async () => {
    server.use(http.post(api("/projects"), () => HttpResponse.error()));

    renderScreen();

    typeUrl("example.com");
    clone();

    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
    expect(push).not.toHaveBeenCalled();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Assignment, EditorStateMap, ExportBundle } from "@/lib/api-client";
import { env } from "@/lib/env";
import { server } from "@/mocks/server";

import { ExportTab, type ExportTabProps } from "./export-tab";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const api = (path: string) => `${env.apiOrigin}${path}`;

function assignment(animationId: string, trigger: Assignment["trigger"] = "load"): Assignment {
  return { animationId, catalogVersion: "1.1.0", trigger, params: {} };
}

const STATE: EditorStateMap = {
  "vm-3": assignment("fade-in-up"),
  "vm-9": assignment("pulse", "hover"),
};

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    versionId: VERSION_ID,
    mode: "full",
    html: "<!doctype html>",
    css: ".vm-a3 {}",
    js: null,
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ],
    ...overrides,
  };
}

/**
 * Every test brings its own handler. The shared mock (`mocks/db.ts`) still
 * answers with the Phase 0 file names — Track C aligns it — so nothing here
 * may depend on it.
 */
function mockExport(
  handler: (query: URLSearchParams) => Response | Promise<Response>,
): { calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(api("/projects/:projectId/export"), ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.push(query);
      return handler(query);
    }),
  );
  return { calls };
}

function renderTab(overrides: Partial<ExportTabProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const props: ExportTabProps = {
    projectId: PROJECT_ID,
    versionId: VERSION_ID,
    versionSeq: 5,
    isCurrent: true,
    state: STATE,
    ...overrides,
  };
  return { ...render(<ExportTab {...props} />, { wrapper: Wrapper }), queryClient };
}

describe("ExportTab", () => {
  it("asks for the full page of the version it was given", async () => {
    const { calls } = mockExport(() => HttpResponse.json(bundle()));

    renderTab();

    await screen.findByRole("tab", { name: "vibe-motion.css" });
    expect(calls[0].get("versionId")).toBe(VERSION_ID);
    expect(calls[0].get("mode")).toBe("full");
    expect(calls[0].get("vmId")).toBeNull();
  });

  it("shows the panel's pending state while the export is being built", async () => {
    mockExport(async () => {
      await delay(50);
      return HttpResponse.json(bundle());
    });

    renderTab();

    expect(screen.getByRole("status", { name: "Preparing the export" })).toBeInTheDocument();
    await screen.findByRole("tab", { name: "vibe-motion.css" });
  });

  it("counts the version's own state in the footer", async () => {
    mockExport(() => HttpResponse.json(bundle()));

    renderTab();

    expect(await screen.findByTestId("export-stats")).toHaveTextContent(
      "2 animations · 2 elements · js not needed (no in-view triggers)",
    );
  });

  it("switches to a snippet of the selected element", async () => {
    const { calls } = mockExport((query) =>
      HttpResponse.json(
        query.get("mode") === "snippet"
          ? bundle({
              mode: "snippet",
              html: null,
              css: '/* add class="vm-a3" to the element */',
              files: [{ name: "vibe-motion.css", contentType: "text/css" }],
            })
          : bundle(),
      ),
    );

    renderTab({ selectedVmId: "vm-3" });
    await screen.findByRole("tab", { name: "index.html" });

    fireEvent.click(screen.getByRole("radio", { name: "Snippet" }));

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(calls[1].get("mode")).toBe("snippet");
    expect(calls[1].get("vmId")).toBe("vm-3");
    // The footer now counts only what the snippet covers.
    expect(screen.getByTestId("export-stats")).toHaveTextContent("1 animation · 1 element");
  });

  it("offers no snippet when nothing animated is selected", async () => {
    mockExport(() => HttpResponse.json(bundle()));

    renderTab({ selectedVmId: "vm-99" });

    await screen.findByRole("tab", { name: "vibe-motion.css" });
    expect(screen.getByRole("radio", { name: "Snippet" })).toHaveAttribute("data-disabled");
  });

  it("shows what the API said went wrong, and retries on demand", async () => {
    let attempts = 0;
    mockExport(() => {
      attempts += 1;
      return attempts === 1
        ? HttpResponse.json(
            { code: "not_found", message: "No version for this project" },
            { status: 404 },
          )
        : HttpResponse.json(bundle());
    });

    renderTab();

    expect(await screen.findByText("No version for this project")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("tab", { name: "vibe-motion.css" })).toBeInTheDocument();
  });

  it("does not retry a failed export by itself", async () => {
    let attempts = 0;
    mockExport(() => {
      attempts += 1;
      return HttpResponse.json({ code: "not_found", message: "gone" }, { status: 404 });
    });

    renderTab();

    await screen.findByText("gone");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(attempts).toBe(1);
  });

  it("asks once per (version, mode, element): a saved export never changes", async () => {
    const { calls } = mockExport(() => HttpResponse.json(bundle()));

    renderTab({ selectedVmId: "vm-3" });
    await screen.findByRole("tab", { name: "index.html" });

    fireEvent.click(screen.getByRole("radio", { name: "Snippet" }));
    await waitFor(() => expect(calls).toHaveLength(2));

    fireEvent.click(screen.getByRole("radio", { name: "Full page" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Full page" })).toHaveAttribute("data-checked"),
    );
    // Back to a bundle it already has: no third request.
    expect(calls).toHaveLength(2);
  });

  it("renders the bundle as text, whatever the API returns", async () => {
    mockExport(() => HttpResponse.json(bundle({ css: '<img src=x onerror="alert(1)">' })));

    const { container } = renderTab();

    await screen.findByRole("tab", { name: "vibe-motion.css" });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("region", { name: "vibe-motion.css" })).toHaveTextContent(
      '<img src=x onerror="alert(1)">',
    );
  });

  it("copies what the API sent, not what the shared mock would have", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mockExport(() => HttpResponse.json(bundle({ css: ".vm-a3 { animation: none; }" })));

    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Copy vibe-motion.css" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(".vm-a3 { animation: none; }"));
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });
});

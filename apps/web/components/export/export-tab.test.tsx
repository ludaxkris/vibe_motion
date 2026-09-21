import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Assignment, EditorStateMap, ExportBundle } from "@/lib/api-client";
import { env } from "@/lib/env";
import { server } from "@/mocks/server";

import { ExportTab, type ExportTabProps, exportErrorMessage } from "./export-tab";

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

afterEach(() => {
  // In an `afterEach`, not at the end of a test body: a failure part-way
  // through would otherwise leak the stub into the rest of the file.
  if ("clipboard" in navigator) {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  }
});

describe("exportErrorMessage", () => {
  it("uses the contract's message when the body is the contract's error", () => {
    expect(exportErrorMessage({ code: "not_found", message: "No version" }, 404)).toBe(
      "No version",
    );
  });

  it("falls back to the status for a body that is not the contract's error", () => {
    // openapi-fetch hands back the raw text when the body is not JSON.
    for (const body of ["<html><body>502 Bad Gateway</body></html>", null, undefined, 7, {}]) {
      expect(exportErrorMessage(body, 502)).toBe("Could not build this export (HTTP 502).");
    }
  });

  it("does not accept an empty or blank message", () => {
    expect(exportErrorMessage({ message: "" }, 500)).toBe(
      "Could not build this export (HTTP 500).",
    );
    expect(exportErrorMessage({ message: "  " }, 500)).toBe(
      "Could not build this export (HTTP 500).",
    );
  });
});

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

    // The refetch reaches React a microtask later, so this is awaited; the
    // handler holds the response for 50ms, which is the window being pinned.
    expect(
      await screen.findByRole("status", { name: "Preparing the export" }),
    ).toBeInTheDocument();
    await screen.findByRole("tab", { name: "vibe-motion.css" });
  });

  it("says something readable when a proxy answers with HTML", async () => {
    mockExport(
      () =>
        new HttpResponse("<html><body><h1>502 Bad Gateway</h1></body></html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );

    renderTab();

    expect(await screen.findByText("Could not build this export (HTTP 502).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("prints no counts when the caller gave no state", async () => {
    mockExport(() => HttpResponse.json(bundle()));

    renderTab({ state: undefined });

    const footer = await screen.findByTestId("export-stats");
    expect(footer).toHaveTextContent("js not needed (no in-view triggers)");
    expect(footer.textContent).not.toMatch(/\d+ (animation|element)/);
  });

  it("takes the footer's script clause off the bundle, not off the state", async () => {
    // Nothing in this state uses in-view, but the saved export carries a
    // script: the zip is the truth.
    mockExport(() =>
      HttpResponse.json(
        bundle({
          js: "(function(){})();",
          files: [
            { name: "index.html", contentType: "text/html" },
            { name: "vibe-motion.css", contentType: "text/css" },
            { name: "vibe-motion.js", contentType: "text/javascript" },
          ],
        }),
      ),
    );

    renderTab();

    expect(await screen.findByTestId("export-stats")).toHaveTextContent(
      "2 animations · 2 elements · includes vibe-motion.js (in-view triggers)",
    );
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

  it("shows the retry happening, and takes Retry away while it does", async () => {
    let attempts = 0;
    mockExport(async () => {
      attempts += 1;
      if (attempts === 1) {
        return HttpResponse.json({ code: "not_found", message: "gone" }, { status: 404 });
      }
      await delay(50);
      return HttpResponse.json(bundle());
    });

    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    // TanStack keeps `status: "error"` through a refetch, so without folding
    // `isFetching` in, the same red message and a live Retry would stay put
    // and the reader would queue the work again.
    // The refetch reaches React a microtask later, so this is awaited; the
    // handler holds the response for 50ms, which is the window being pinned.
    expect(
      await screen.findByRole("status", { name: "Preparing the export" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByText("gone")).not.toBeInTheDocument();

    await screen.findByRole("tab", { name: "vibe-motion.css" });
    expect(attempts).toBe(2);
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
  });
});

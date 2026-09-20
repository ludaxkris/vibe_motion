import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/toast";
import type { ExportBundle } from "@/lib/api-client";

import { ExportPanel, type ExportPanelProps } from "./export-panel";

const CSS = ".vm-a17 {\n  animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;\n}";
const HTML = '<!doctype html><html><head></head><body><h1 class="vm-a17">Hi</h1></body></html>';
const JS = "(function(){document.documentElement.classList.add('vm-js')})();";

function fullBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    versionId: "11111111-1111-4111-8111-111111111111",
    mode: "full",
    html: HTML,
    css: CSS,
    js: null,
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<ExportPanelProps> = {}) {
  const props: ExportPanelProps = {
    bundle: fullBundle(),
    status: "ready",
    versionSeq: 5,
    isCurrent: true,
    mode: "full",
    onModeChange: vi.fn(),
    snippetAvailable: true,
    counts: { animations: 2, elements: 4 },
    projectSlug: "Nimbus App",
    ...overrides,
  };
  return { ...render(<ExportPanel {...props} />), props };
}

function toastMessage(): string | undefined {
  return useToastStore.getState().current?.message;
}

/** jsdom has no async clipboard; each test says which one it is exercising. */
function stubClipboard(writeText: () => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: spy }, configurable: true });
  return spy;
}

beforeEach(() => {
  useToastStore.setState({ current: null });
});

afterEach(() => {
  if ("clipboard" in navigator) {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  }
  for (const key of ["createObjectURL", "revokeObjectURL"] as const) {
    if (key in URL) delete (URL as unknown as Record<string, unknown>)[key];
  }
  vi.restoreAllMocks();
});

describe("ExportPanel", () => {
  it("heads the panel with the version it is exporting", () => {
    renderPanel();

    expect(screen.getByText("Exporting")).toBeInTheDocument();
    expect(screen.getByText("v5")).toHaveClass("font-mono");
    expect(screen.getByText("· current")).toBeInTheDocument();
  });

  it("says nothing about `current` when an older version is open", () => {
    renderPanel({ versionSeq: 3, isCurrent: false });

    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.queryByText("· current")).not.toBeInTheDocument();
  });

  it("offers the two modes with the handoff's caption", () => {
    const { props } = renderPanel();

    expect(
      screen.getByText(
        "Full page replaces the HTML. Snippet gives CSS + class names to paste into your existing site.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Snippet" }));
    expect(props.onModeChange).toHaveBeenCalledWith("snippet");
  });

  it("disables Snippet, and says why, until an animated element is selected", () => {
    const { props } = renderPanel({ snippetAvailable: false });

    const snippet = screen.getByRole("radio", { name: "Snippet" });
    expect(snippet).toHaveAttribute("data-disabled");
    expect(
      screen.getByText("Select an animated element on the page to export a snippet."),
    ).toBeInTheDocument();

    fireEvent.click(snippet);
    expect(props.onModeChange).not.toHaveBeenCalled();
    // Full page is still live.
    expect(screen.getByRole("radio", { name: "Full page" })).not.toHaveAttribute("data-disabled");
  });

  it("opens on the stylesheet and shows its text", () => {
    renderPanel();

    expect(screen.getByRole("tab", { name: "vibe-motion.css" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("region", { name: "vibe-motion.css" })).toHaveTextContent(
      "vm-fade-in-up-v1-1-0",
    );
  });

  it("counts what is in the export", () => {
    renderPanel();

    expect(screen.getByTestId("export-stats")).toHaveTextContent(
      "2 animations · 4 elements · js not needed (no in-view triggers)",
    );
  });

  it("takes `js not needed` off the bundle, never off the caller", () => {
    // The footer and the zip must not be able to disagree about whether the
    // script is in the download.
    renderPanel({
      bundle: fullBundle({
        js: JS,
        files: [
          { name: "index.html", contentType: "text/html" },
          { name: "vibe-motion.css", contentType: "text/css" },
          { name: "vibe-motion.js", contentType: "text/javascript" },
        ],
      }),
    });

    expect(screen.getByTestId("export-stats")).toHaveTextContent(
      "2 animations · 4 elements · includes vibe-motion.js (in-view triggers)",
    );
  });

  it("prints no counts rather than zeroes when the caller has none", () => {
    renderPanel({ counts: undefined });

    const footer = screen.getByTestId("export-stats");
    expect(footer).toHaveTextContent("js not needed (no in-view triggers)");
    expect(footer.textContent).not.toMatch(/\d+ (animation|element)/);
  });

  it("copies one file and says which", async () => {
    const writeText = stubClipboard(async () => {});
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Copy vibe-motion.css" }));

    await waitFor(() => expect(toastMessage()).toBe("Copied CSS"));
    expect(writeText).toHaveBeenCalledWith(CSS);

    fireEvent.click(screen.getByRole("tab", { name: "index.html" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy index.html" }));

    await waitFor(() => expect(toastMessage()).toBe("Copied HTML"));
    expect(writeText).toHaveBeenLastCalledWith(HTML);
  });

  it("copies the script under its own name", async () => {
    const writeText = stubClipboard(async () => {});
    renderPanel({
      bundle: fullBundle({
        js: JS,
        files: [
          { name: "index.html", contentType: "text/html" },
          { name: "vibe-motion.css", contentType: "text/css" },
          { name: "vibe-motion.js", contentType: "text/javascript" },
        ],
      }),
    });

    fireEvent.click(screen.getByRole("tab", { name: "vibe-motion.js" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy vibe-motion.js" }));

    await waitFor(() => expect(toastMessage()).toBe("Copied JS"));
    expect(writeText).toHaveBeenCalledWith(JS);
  });

  it("copies every file at once, each behind a separator in its own syntax", async () => {
    const writeText = stubClipboard(async () => {});
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));

    await waitFor(() => expect(toastMessage()).toBe("Copied all"));
    expect(writeText).toHaveBeenCalledWith(
      `<!-- === index.html === -->\n${HTML}\n\n/* === vibe-motion.css === */\n${CSS}`,
    );
  });

  it("says so when the copy did not happen", async () => {
    stubClipboard(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Copy vibe-motion.css" }));

    await waitFor(() => expect(toastMessage()).toBe("Copy failed"));
  });

  it("downloads a zip named for the project and the version", () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:vitest/1";
      }),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Download .zip" }));

    expect(clicked[0].download).toBe("vibe-motion-nimbus-app-v5.zip");
    expect(blobs[0].type).toBe("application/zip");
  });

  it("puts the bundle and a README in that zip", async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:vitest/1";
      }),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Download .zip" }));

    // The blob the browser was handed is the zip; read it back out of it.
    const unzipped = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
    expect(Object.keys(unzipped)).toEqual(["index.html", "vibe-motion.css", "README.txt"]);
    expect(strFromU8(unzipped["vibe-motion.css"])).toBe(CSS);
    expect(strFromU8(unzipped["README.txt"])).toContain("v5");
  });

  it("shows a spinner and no controls while the export is being built", () => {
    renderPanel({ status: "pending", bundle: undefined, counts: undefined });

    expect(screen.getByRole("status", { name: "Preparing the export" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download .zip" })).toBeDisabled();
  });

  it("shows what went wrong and offers to try again", () => {
    const onRetry = vi.fn();
    renderPanel({
      status: "error",
      bundle: undefined,
      counts: undefined,
      errorMessage: "No version 9 in this project",
      onRetry,
    });

    expect(screen.getByText("No version 9 in this project")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Download .zip" })).toBeDisabled();
  });

  it("never shows an empty red line where an error should be", () => {
    // A proxy's `text/html` 502 leaves the API message an empty string.
    for (const errorMessage of [undefined, "", "   "]) {
      const { unmount } = renderPanel({
        status: "error",
        bundle: undefined,
        counts: undefined,
        errorMessage,
        onRetry: vi.fn(),
      });
      expect(screen.getByText("Could not build this export.")).toBeInTheDocument();
      unmount();
    }
  });

  it("shows a snippet's one file", () => {
    renderPanel({
      mode: "snippet",
      bundle: {
        versionId: "11111111-1111-4111-8111-111111111111",
        mode: "snippet",
        html: null,
        css: '/* add class="vm-a17" to the element */',
        js: null,
        files: [{ name: "vibe-motion.css", contentType: "text/css" }],
      },
      counts: { animations: 1, elements: 1 },
    });

    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByTestId("export-stats")).toHaveTextContent("1 animation · 1 element");
  });

  it("renders bundle text as text, whatever is in it", () => {
    const { container } = renderPanel({
      bundle: fullBundle({ css: '<img src=x onerror="alert(1)">' }),
    });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("region", { name: "vibe-motion.css" })).toHaveTextContent(
      '<img src=x onerror="alert(1)">',
    );
  });
});

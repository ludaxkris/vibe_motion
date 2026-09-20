import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ExportBundle } from "@/lib/api-client";

import { FileTabs, type ExportFileView, bundleFileViews } from "./file-tabs";

function fullBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    versionId: "11111111-1111-4111-8111-111111111111",
    mode: "full",
    html: "<!doctype html>",
    css: ".vm-a17 {}",
    js: null,
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ],
    ...overrides,
  };
}

describe("bundleFileViews", () => {
  it("shows the script faint and empty when this export does not need it", () => {
    expect(bundleFileViews(fullBundle())).toEqual([
      { name: "index.html", kind: "html", code: "<!doctype html>" },
      { name: "vibe-motion.css", kind: "css", code: ".vm-a17 {}" },
      { name: "vibe-motion.js", kind: "js", code: null },
    ]);
  });

  it("shows the script's real text when an assignment uses in-view", () => {
    const views = bundleFileViews(
      fullBundle({
        js: "(function(){})();",
        files: [
          { name: "index.html", contentType: "text/html" },
          { name: "vibe-motion.css", contentType: "text/css" },
          { name: "vibe-motion.js", contentType: "text/javascript" },
        ],
      }),
    );

    expect(views).toHaveLength(3);
    expect(views[2]).toEqual({
      name: "vibe-motion.js",
      kind: "js",
      code: "(function(){})();",
    });
  });

  it("gives a snippet only the files it has", () => {
    const views = bundleFileViews({
      versionId: "11111111-1111-4111-8111-111111111111",
      mode: "snippet",
      html: null,
      css: '/* add class="vm-a17" to the element */',
      js: null,
      files: [{ name: "vibe-motion.css", contentType: "text/css" }],
    });

    expect(views.map((view) => view.name)).toEqual(["vibe-motion.css"]);
  });
});

const VIEWS: ExportFileView[] = [
  { name: "index.html", kind: "html", code: "<!doctype html>" },
  { name: "vibe-motion.css", kind: "css", code: ".vm-a17 {}" },
  { name: "vibe-motion.js", kind: "js", code: null },
];

function Harness({
  files = VIEWS,
  onCopy,
  initial = "vibe-motion.css",
}: {
  files?: ExportFileView[];
  onCopy?: (file: ExportFileView) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return <FileTabs files={files} value={value} onValueChange={setValue} onCopy={onCopy} />;
}

describe("FileTabs", () => {
  it("is a real tab list, one tab per file", () => {
    render(<Harness />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "index.html",
      "vibe-motion.css",
      "vibe-motion.js",
    ]);
    expect(screen.getByRole("tab", { name: "vibe-motion.css" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders the file with nothing in it faint and disabled", () => {
    render(<Harness />);

    const unused = screen.getByRole("tab", { name: "vibe-motion.js" });
    // Base UI marks a disabled tab with `aria-disabled` rather than the native
    // attribute, so a screen-reader reader can still find it and be told why.
    expect(unused).toHaveAttribute("aria-disabled", "true");
    expect(unused).toHaveAttribute("data-disabled");
    expect(unused).toHaveClass("data-disabled:text-vm-ink-3");
  });

  it("shows only the open file's code", () => {
    render(<Harness />);

    expect(screen.getByRole("region", { name: "vibe-motion.css" })).toHaveTextContent(
      ".vm-a17 {}",
    );
    expect(screen.queryByRole("region", { name: "index.html" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "index.html" }));

    expect(screen.getByRole("region", { name: "index.html" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "vibe-motion.css" })).not.toBeInTheDocument();
  });

  /** Where the strip's single tab stop is — what an arrow key moves. */
  function tabStop(): string {
    const stops = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") !== "-1");
    expect(stops).toHaveLength(1);
    return stops[0].textContent ?? "";
  }

  it("moves along the strip with the arrow keys, and round at the end", () => {
    render(<Harness initial="index.html" />);
    const list = screen.getByRole("tablist");
    // The strip only answers arrow keys once it has focus, as a tablist should.
    screen.getByRole("tab", { name: "index.html" }).focus();

    expect(tabStop()).toBe("index.html");

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tabStop()).toBe("vibe-motion.css");

    // The empty file is still reachable — it is there to be read, and a
    // control nobody can reach is a control nobody can be told about.
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tabStop()).toBe("vibe-motion.js");

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tabStop()).toBe("index.html");

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tabStop()).toBe("vibe-motion.js");
  });

  it("will not open the file with nothing in it", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("tab", { name: "vibe-motion.js" }));

    expect(screen.getByRole("tab", { name: "vibe-motion.css" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("region", { name: "vibe-motion.css" })).toBeInTheDocument();
  });

  it("takes one tab stop, not one per file", () => {
    render(<Harness />);

    expect(tabStop()).toBe("vibe-motion.css");
  });

  it("copies the file that is open", () => {
    const onCopy = vi.fn();
    render(<Harness onCopy={onCopy} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy vibe-motion.css" }));

    expect(onCopy).toHaveBeenCalledWith(VIEWS[1]);
  });
});

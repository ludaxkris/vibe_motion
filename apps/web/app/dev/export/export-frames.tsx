"use client";

import { useState } from "react";

import { ExportPanel, type ExportMode } from "@/components/export/export-panel";
import type { ExportBundle } from "@/lib/api-client";

import { Frame, TALL_PANEL_FRAME } from "../frame";

/**
 * The handoff's own sample, brought up to date: classes are `vm-a<N>` and
 * keyframes names carry the pinned catalog version (`vm-<id>-v1-1-0`).
 */
const CSS = `/* Vibe Motion · format 1 · v5 · saved 2026-09-20 (UTC) · catalog 1.1.0 */
@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0; transform: translateY(var(--vm-distance)); } to { opacity: 1; transform: none; } }
@keyframes vm-pulse-v1-1-0 { from { transform: none; } 50% { transform: scale(var(--vm-scale)); } to { transform: none; } }

@media (prefers-reduced-motion: no-preference) {
  /* load */
  .vm-a17 {
    --vm-distance: 24px;
    animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;
  }

  /* hover */
  .vm-a42 { --vm-scale: 1.05; }
  .vm-a42:hover {
    animation: vm-pulse-v1-1-0 400ms ease-out 0ms 1 normal forwards;
  }
}
`;

const CSS_WITH_IN_VIEW = `${CSS.trimEnd()}

@media (prefers-reduced-motion: no-preference) {
  /* in-view */
  :where(.vm-js) .vm-a63 {
    --vm-distance: 24px;
    animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;
  }
  :where(.vm-js) .vm-in-view:not(.vm-play) {
    animation-play-state: paused;
    animation-delay: 0s;
    animation-fill-mode: both;
  }
}
`;

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Pricing</title>
    <link rel="stylesheet" href="vibe-motion.css">
  </head>
  <body>
    <h1 class="headline vm-a17">Pricing that scales with you</h1>
    <a class="cta vm-a42" href="/signup">Start free</a>
  </body>
</html>
`;

const JS = `(function () {
  var root = document.documentElement;
  root.classList.add("vm-js");
  function playAll() {
    document.querySelectorAll(".vm-in-view").forEach(function (el) {
      el.classList.add("vm-play");
    });
  }
  if (!("IntersectionObserver" in window)) return playAll();
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("vm-play");
          observer.unobserve(entry.target);
        });
      }, { threshold: [0, 0.2] });
      document.querySelectorAll(".vm-in-view").forEach(function (el) {
        observer.observe(el);
      });
    } catch (error) {
      playAll();
    }
  });
})();
`;

const SNIPPET_CSS = `/* Vibe Motion · format 1 · v5 · saved 2026-09-20 (UTC) · catalog 1.1.0 */
/* add class="vm-a17" to the element */
@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0; transform: translateY(var(--vm-distance)); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: no-preference) {
  .vm-a17 {
    --vm-distance: 24px;
    animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;
  }
}
`;

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

const FULL_NO_JS: ExportBundle = {
  versionId: VERSION_ID,
  mode: "full",
  html: HTML,
  css: CSS,
  js: null,
  files: [
    { name: "index.html", contentType: "text/html" },
    { name: "vibe-motion.css", contentType: "text/css" },
  ],
};

const FULL_WITH_JS: ExportBundle = {
  versionId: VERSION_ID,
  mode: "full",
  html: HTML,
  css: CSS_WITH_IN_VIEW,
  js: JS,
  files: [
    { name: "index.html", contentType: "text/html" },
    { name: "vibe-motion.css", contentType: "text/css" },
    { name: "vibe-motion.js", contentType: "text/javascript" },
  ],
};

const SNIPPET: ExportBundle = {
  versionId: VERSION_ID,
  mode: "snippet",
  html: null,
  css: SNIPPET_CSS,
  js: null,
  files: [{ name: "vibe-motion.css", contentType: "text/css" }],
};

/** One frame with a live mode switch, so the segmented control can be read. */
function PanelFrame({
  bundle,
  snippetAvailable,
  versionSeq = 5,
  isCurrent = true,
}: {
  bundle: ExportBundle;
  snippetAvailable: boolean;
  versionSeq?: number;
  isCurrent?: boolean;
}) {
  const [mode, setMode] = useState<ExportMode>(bundle.mode);
  return (
    <ExportPanel
      bundle={bundle}
      status="ready"
      versionSeq={versionSeq}
      isCurrent={isCurrent}
      mode={snippetAvailable ? mode : "full"}
      onModeChange={setMode}
      snippetAvailable={snippetAvailable}
      counts={{
        animations: bundle.mode === "snippet" ? 1 : 2,
        elements: bundle.mode === "snippet" ? 1 : bundle.js ? 3 : 2,
      }}
      projectSlug="Nimbus App"
    />
  );
}

/**
 * Dev-only: every Export tab state side by side, at its real width, for
 * reading against the Claude Design mocks and for the screenshot runner.
 *
 * Store-free and fetch-free on purpose — these are `ExportPanel`, the
 * presentational half, so nothing here needs the editor store, React Query or
 * the MSW mock. `ExportTab`, the container, is covered by its unit tests and
 * mounted for real in Track C. Its own route, not linked from `/dev`: both
 * open PRs edit that gallery.
 */
export function ExportFrames() {
  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Export tab</h2>
        <p className="max-w-[60ch] text-sm leading-body text-vm-ink-2">
          `docs/design/README.md`, &ldquo;Export tab&rdquo;. Copy and Download .zip are live:
          the zip is built here in the browser.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        <Frame
          bodyClassName={TALL_PANEL_FRAME}
          slug="export-full-js"
          title="Full page · in-view, so the script is in the zip"
          note="Three files. The footer says the script is included."
        >
          <PanelFrame bundle={FULL_WITH_JS} snippetAvailable />
        </Frame>

        <Frame
          bodyClassName={TALL_PANEL_FRAME}
          slug="export-full-no-js"
          title="Full page · no in-view trigger"
          note="vibe-motion.js is faint and cannot be opened: it is not needed here."
        >
          <PanelFrame bundle={FULL_NO_JS} snippetAvailable={false} />
        </Frame>

        <Frame
          bodyClassName={TALL_PANEL_FRAME}
          slug="export-snippet"
          title="Snippet · one element"
          note="One file, and the class name to paste is in the comment at the top."
        >
          <PanelFrame bundle={SNIPPET} snippetAvailable versionSeq={3} isCurrent={false} />
        </Frame>

        <Frame bodyClassName={TALL_PANEL_FRAME} slug="export-pending" title="Waiting for the API">
          <ExportPanel
            bundle={undefined}
            status="pending"
            versionSeq={5}
            isCurrent
            mode="full"
            onModeChange={() => {}}
            snippetAvailable={false}
          />
        </Frame>

        <Frame bodyClassName={TALL_PANEL_FRAME} slug="export-error" title="The export could not be built">
          <ExportPanel
            bundle={undefined}
            status="error"
            errorMessage="No version for this project"
            versionSeq={5}
            isCurrent
            mode="full"
            onModeChange={() => {}}
            snippetAvailable={false}
            onRetry={() => {}}
          />
        </Frame>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { PanelCard, PanelSection } from "@/components/control-panel/panel-card";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import type { ExportBundle } from "@/lib/api-client";

import { buildZip, zipFileName } from "./build-zip";
import { type ExportFileView, FileTabs, bundleFileViews } from "./file-tabs";
import { type ExportStats, formatExportStats } from "./export-stats";
import { buildReadme } from "./readme";
import { downloadZip } from "./download";
import { useClipboard } from "./use-clipboard";

export type ExportMode = ExportBundle["mode"];

const MODE_OPTIONS = [
  { value: "full", label: "Full page" },
  { value: "snippet", label: "Snippet" },
] as const;

/** `docs/design/README.md`, "Export tab" — verbatim. */
const CAPTION =
  "Full page replaces the HTML. Snippet gives CSS + class names to paste into your existing site.";

/** Said next to the disabled segment, so the reason is on screen, not guessed. */
const SNIPPET_HINT = "Select an animated element on the page to export a snippet.";

/** One line above each file in "Copy all", in that file's own comment syntax. */
function fileSeparator(file: ExportFileView): string {
  return file.kind === "html" ? `<!-- === ${file.name} === -->` : `/* === ${file.name} === */`;
}

/** "Copied CSS" / "Copied HTML" / "Copied JS". */
function copiedMessage(file: ExportFileView): string {
  return file.kind ? `Copied ${file.kind.toUpperCase()}` : `Copied ${file.name}`;
}

export type ExportPanelProps = {
  bundle: ExportBundle | undefined;
  status: "pending" | "error" | "ready";
  /** What the API said went wrong; shown above Retry. */
  errorMessage?: string;
  /** The version being exported. The label defaults to `v<seq>`. */
  versionSeq: number;
  versionLabel?: string;
  isCurrent: boolean;
  mode: ExportMode;
  onModeChange: (mode: ExportMode) => void;
  /** False when no element is selected, or the selected one has no animation. */
  snippetAvailable: boolean;
  stats?: ExportStats;
  onRetry?: () => void;
  /** The project's name; only the download file name ever sees it. */
  projectSlug?: string;
};

/**
 * The Export tab (`docs/design/README.md` "Export tab",
 * `docs/design/mocks/Vibe Motion Hi-fi.dc.html` frame 2j).
 *
 * Presentational: it is given a bundle and never asks for one. Copying and
 * zipping happen here because both are pure client-side work on text it
 * already holds — no request, nothing to mock.
 */
export function ExportPanel({
  bundle,
  status,
  errorMessage,
  versionSeq,
  versionLabel,
  isCurrent,
  mode,
  onModeChange,
  snippetAvailable,
  stats,
  onRetry,
  projectSlug,
}: ExportPanelProps) {
  const { toast } = useToast();
  const copy = useClipboard();
  const [openFile, setOpenFile] = useState<string | null>(null);

  const files = useMemo(() => (bundle ? bundleFileViews(bundle) : []), [bundle]);
  // Derived rather than kept in an effect: the tab a mode switch opens on is a
  // function of the bundle, and the handoff opens on the stylesheet.
  const fallbackFile =
    files.find((file) => file.kind === "css" && file.code !== null)?.name ??
    files.find((file) => file.code !== null)?.name ??
    "";
  const activeFile = files.some((file) => file.name === openFile && file.code !== null)
    ? (openFile ?? fallbackFile)
    : fallbackFile;

  const label = versionLabel ?? `v${versionSeq}`;
  const ready = status === "ready" && bundle !== undefined;

  async function copyOne(file: ExportFileView) {
    if (file.code === null) return;
    toast((await copy(file.code)) ? copiedMessage(file) : "Copy failed");
  }

  async function copyAll() {
    if (!bundle) return;
    const text = files
      .filter((file) => file.code !== null)
      .map((file) => `${fileSeparator(file)}\n${file.code}`)
      .join("\n\n");
    toast((await copy(text)) ? "Copied all" : "Copy failed");
  }

  function download() {
    if (!bundle) return;
    const readme = buildReadme(bundle, { versionLabel: label });
    const saved = downloadZip(
      zipFileName({ slug: projectSlug, versionSeq }),
      buildZip(bundle, readme),
    );
    if (!saved) toast("Download failed");
  }

  return (
    <PanelCard data-testid="panel-export" className="min-h-0 flex-1">
      <PanelSection className="gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel>Exporting</SectionLabel>
          <span className="shrink-0 text-sm whitespace-nowrap">
            <span className="font-mono font-semibold">{label}</span>
            {isCurrent ? <span className="text-vm-ink-2"> · current</span> : null}
          </span>
        </div>

        <Segmented
          aria-label="Export mode"
          options={[
            MODE_OPTIONS[0],
            { ...MODE_OPTIONS[1], disabled: !snippetAvailable },
          ]}
          value={mode}
          onValueChange={(next) => onModeChange(next as ExportMode)}
        />

        {snippetAvailable ? null : <p className="text-xs text-vm-ink-3">{SNIPPET_HINT}</p>}
        <p className="text-xs leading-body text-vm-ink-3">{CAPTION}</p>
      </PanelSection>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 pb-2">
        {status === "pending" ? (
          <div
            role="status"
            aria-label="Preparing the export"
            className="flex flex-1 items-center justify-center"
          >
            <div className="size-6 animate-spin rounded-full border-2 border-vm-border border-t-vm-accent" />
          </div>
        ) : null}

        {status === "error" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-md text-vm-danger">
              {errorMessage ?? "Could not build this export."}
            </p>
            {onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}

        {ready ? (
          <>
            <FileTabs
              files={files}
              value={activeFile}
              onValueChange={setOpenFile}
              onCopy={(file) => void copyOne(file)}
            />
            {stats ? (
              <p data-testid="export-stats" className="text-xs text-vm-ink-2">
                {formatExportStats(stats)}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <PanelSection className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={!ready} onClick={() => void copyAll()}>
          Copy all
        </Button>
        <Button variant="ink" className="flex-[1.3]" disabled={!ready} onClick={download}>
          Download .zip
        </Button>
      </PanelSection>
    </PanelCard>
  );
}

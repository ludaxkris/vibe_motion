"use client";

import { cn } from "cn";

/**
 * How much of a file the preview shows.
 *
 * Counted in characters: the exported HTML, CSS and JavaScript are effectively
 * ASCII, so one character is one byte to within a rounding error, and counting
 * real UTF-8 bytes would mean encoding the whole file on every render — the
 * cost this cap exists to avoid.
 */
export const CODE_PREVIEW_LIMIT = 200 * 1024;

/** "200 KB", "1.4 MB" — the size as the note says it. */
export function formatCodeSize(characters: number): string {
  const kb = characters / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

/**
 * The Export tab's ink code block (`docs/design/README.md`, "Export tab":
 * `#1d1d1f` on `#d4d4d8` text, 10.5px/1.6 mono, radii `0 8px 8px 8px`, a
 * "Copy" pill top-right in white 10%).
 *
 * The bundle's text is rendered as **text**. It is HTML, CSS and JavaScript
 * from a page this app cloned, so `dangerouslySetInnerHTML` here would run a
 * cloned page's script on the editor's own origin (plan §1.7). The same reason
 * the tab never builds a `text/html` blob URL.
 *
 * Only the first `CODE_PREVIEW_LIMIT` characters are put in the DOM: a
 * multi-megabyte page in one non-wrapping `white-space: pre` block is a text
 * node no browser lays out cheaply. Copy and the zip always take the whole
 * file, and the note says so rather than leaving the reader to wonder.
 *
 * The block is focusable and scrollable, with a name, so a keyboard reader can
 * reach the code at all — a scroll container that cannot be focused is a
 * WCAG 2.1.1 failure.
 */
export function CodeBlock({
  code,
  fileName,
  onCopy,
  copyLabel = "Copy",
  className,
}: {
  code: string;
  /** Names the region, so "region, vibe-motion.css" is what gets announced. */
  fileName: string;
  /** Omitted on a file with nothing to copy. */
  onCopy?: () => void;
  copyLabel?: string;
  className?: string;
}) {
  const truncated = code.length > CODE_PREVIEW_LIMIT;
  const shown = truncated ? code.slice(0, CODE_PREVIEW_LIMIT) : code;

  return (
    <div
      data-slot="export-code-block"
      className={cn(
        // Square top-left: the block hangs off the active file tab, the same
        // shape as `PanelCard` under the panel's folder tabs.
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md rounded-tl-none bg-vm-ink",
        className,
      )}
    >
      <pre
        // A labelled scroll container, so the code is reachable by keyboard
        // and announced as something with a name.
        role="region"
        aria-label={fileName}
        tabIndex={0}
        className={cn(
          "min-h-0 flex-1 overflow-auto px-3 pt-[30px] pb-3",
          // The handoff's own type for this block; no token is this small.
          "font-mono text-[10.5px] leading-[1.6] whitespace-pre text-[#d4d4d8]",
          "outline-none focus-visible:ring-2 focus-visible:ring-vm-accent focus-visible:ring-inset",
        )}
      >
        {shown}
      </pre>
      {truncated ? (
        <p
          data-testid="code-block-truncated"
          className="shrink-0 border-t border-white/10 px-3 py-1.5 text-xs leading-body text-white/60"
        >
          {`Showing the first ${formatCodeSize(CODE_PREVIEW_LIMIT)} of ${formatCodeSize(
            code.length,
          )}. Copy and Download include the whole file.`}
        </p>
      ) : null}
      {onCopy ? (
        <button
          type="button"
          onClick={onCopy}
          // Visibly just "Copy"; named per file, because a screen reader hears
          // the button out of its context.
          aria-label={`${copyLabel} ${fileName}`}
          className={cn(
            "absolute top-2 right-2 rounded-[5px] bg-white/10 px-2 py-[3px]",
            "text-xs font-medium text-white",
            "transition-colors duration-(--dur-fast) ease-standard hover:bg-white/20",
            "focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none",
          )}
        >
          {copyLabel}
        </button>
      ) : null}
    </div>
  );
}

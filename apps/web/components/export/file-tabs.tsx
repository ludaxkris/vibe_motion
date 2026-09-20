"use client";

import { Tabs } from "@base-ui/react/tabs";
import { cn } from "cn";

import type { ExportBundle } from "@/lib/api-client";

import { type ExportFileKind, bundleFileKind, bundleFileText } from "./build-zip";
import { CodeBlock } from "./code-block";

/** The name the exporter gives the in-view script (plan §1.1). */
export const IN_VIEW_SCRIPT_FILE_NAME = "vibe-motion.js";

export type ExportFileView = {
  name: string;
  kind: ExportFileKind | null;
  /** `null` for a tab the bundle has no text for — the unused script. */
  code: string | null;
};

/**
 * One tab per file, in the order the API listed them.
 *
 * A full-page export with no `in-view` trigger carries no script and so does
 * not list one — but the handoff still shows `vibe-motion.js`, faint, to say
 * that it exists and is not needed here. A snippet shows only what it has.
 */
export function bundleFileViews(bundle: ExportBundle): ExportFileView[] {
  const views: ExportFileView[] = bundle.files.map((file) => ({
    name: file.name,
    kind: bundleFileKind(file),
    code: bundleFileText(bundle, file),
  }));
  if (bundle.mode === "full" && !views.some((view) => view.kind === "js")) {
    views.push({ name: IN_VIEW_SCRIPT_FILE_NAME, kind: "js", code: null });
  }
  return views;
}

/**
 * The mono file strip and the code block under it (`docs/design/README.md`,
 * "Export tab").
 *
 * Real tabs, on Base UI's `Tabs`: roles, arrow-key movement and one tab stop
 * for the strip. A tab with no text is `disabled` — `aria-disabled`, so it
 * cannot be opened but can still be arrowed to and read out. That is the
 * point of the faint `vibe-motion.js`: it says the script exists and that this
 * export does not need it.
 */
export function FileTabs({
  files,
  value,
  onValueChange,
  onCopy,
  className,
}: {
  files: readonly ExportFileView[];
  value: string;
  onValueChange: (name: string) => void;
  onCopy?: (file: ExportFileView) => void;
  className?: string;
}) {
  const active = files.find((file) => file.name === value);

  return (
    <Tabs.Root
      data-slot="export-file-tabs"
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <Tabs.List className="flex gap-0.5 whitespace-nowrap">
        {files.map((file) => (
          <Tabs.Tab
            key={file.name}
            value={file.name}
            disabled={file.code === null}
            className={cn(
              "rounded-t-sm px-2 py-1.5 font-mono text-xs font-medium",
              "transition-colors duration-(--dur-fast) ease-standard",
              "text-vm-ink-2 hover:text-vm-ink",
              // "faint if unused" — the script this export does not need.
              "data-disabled:pointer-events-none data-disabled:text-vm-ink-3",
              "data-active:bg-vm-ink data-active:text-vm-ink-inverse",
              "focus-visible:ring-2 focus-visible:ring-vm-accent focus-visible:outline-none",
            )}
          >
            {file.name}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      {files.map((file) => (
        <Tabs.Panel
          key={file.name}
          value={file.name}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          {/* Only the open file is built: three code blocks in the DOM would
              be three copies of a possibly very large export. */}
          {file === active && file.code !== null ? (
            <CodeBlock
              code={file.code}
              fileName={file.name}
              onCopy={onCopy ? () => onCopy(file) : undefined}
            />
          ) : null}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}

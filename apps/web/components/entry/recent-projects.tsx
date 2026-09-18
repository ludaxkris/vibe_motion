import { cn } from "cn";
import Link from "next/link";
import { useId } from "react";

import {
  formatRelativeTime,
  sourceUrlHost,
  type RecentProject,
} from "@/lib/recent-projects";

/**
 * The Entry screen's right column (`docs/design/README.md` "1. Entry").
 *
 * There is no list endpoint, so this is whatever this browser has created or
 * opened (`lib/recent-projects.ts`). The whole column is hidden when that is
 * nothing — the handoff's "View all" has nowhere to go and is dropped (ruling
 * in docs/plans/phase-3-web-shell.md, "Design handoff").
 */
export function RecentProjects({
  projects,
  dimmed = false,
  now,
}: {
  projects: readonly RecentProject[];
  /** 50% while a clone is running, so the eye stays on the card. */
  dimmed?: boolean;
  /** Fixed clock, for tests. */
  now?: Date;
}) {
  const headingId = useId();

  if (projects.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex min-w-0 flex-col gap-3 pt-3",
        "transition-opacity duration-(--dur-base) ease-standard",
        dimmed && "opacity-50",
      )}
    >
      <h2 id={headingId} className="text-md font-semibold">
        Recent projects
      </h2>

      <ul className="overflow-hidden rounded-2xl border border-vm-border bg-vm-surface">
        {projects.map((project, index) => (
          <li
            key={project.id}
            className={index < projects.length - 1 ? "border-b border-vm-divider" : undefined}
          >
            <Link
              href={`/p/${project.id}`}
              // The row's own text is the project, not the action; naming the
              // link says what following it does.
              aria-label={`Open ${project.title}`}
              className="flex items-center gap-3 px-3.5 py-3 transition-colors duration-(--dur-fast) ease-standard hover:bg-vm-surface-muted"
            >
              <span
                aria-hidden="true"
                className="h-[38px] w-[56px] shrink-0 rounded-sm border border-vm-border bg-vm-surface-muted"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-md font-medium">{project.title}</span>
                <span className="truncate text-xs text-vm-ink-2">
                  {sourceUrlHost(project.sourceUrl)} · {formatRelativeTime(project.openedAt, now)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium text-vm-accent">Open</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-body text-vm-ink-3">
        Opening a recent project loads its current version. Earlier versions are in History inside
        the editor.
      </p>
    </section>
  );
}

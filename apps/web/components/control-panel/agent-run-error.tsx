import type { RunFailure } from "@/lib/agent/run";

/** Phase 5 plan D10: one inline line under the button, and the draft untouched. */
const COPY: Record<RunFailure, string> = {
  "query-failed": "Couldn't read the page. Try again.",
  "agent-failed": "Couldn't read the page. Try again.",
  "no-targets": "Nothing on this page looks worth animating.",
};

/**
 * The agent buttons' live region: why the last run did nothing, or that one is
 * in flight.
 *
 * Always mounted, and empty while there is nothing to say. Assistive tech
 * announces a *change* to a region it is already watching; one that arrives
 * together with its text is mostly not spoken. The busy line lives here for
 * the same reason — `aria-busy` on a button that is also `disabled` is never
 * reached — and is visually hidden because the button already reads
 * "Generating…". Off screen rather than `display: none` while empty, so it
 * stays in the accessibility tree without taking a flex gap.
 */
export function AgentRunError({ error, busy = false }: { error?: RunFailure | null; busy?: boolean }) {
  return (
    <p
      role="status"
      data-testid="agent-run-status"
      className={error ? "text-xs leading-body text-vm-ink-2" : "sr-only"}
    >
      {error ? <span data-testid="agent-run-error">{COPY[error]}</span> : busy ? "Generating…" : null}
    </p>
  );
}

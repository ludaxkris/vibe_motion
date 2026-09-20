import type { RunFailure } from "@/lib/agent/run";

/** Phase 5 plan D10: one inline line under the button, and the draft untouched. */
const COPY: Record<RunFailure, string> = {
  "query-failed": "Couldn't read the page. Try again.",
  "agent-failed": "Couldn't read the page. Try again.",
  "no-targets": "Nothing on this page looks worth animating.",
};

/** Why the last agent run did nothing, or nothing at all when it did not fail. */
export function AgentRunError({ error }: { error?: RunFailure | null }) {
  if (!error) return null;
  return (
    <p role="status" data-testid="agent-run-error" className="text-xs leading-body text-vm-ink-2">
      {COPY[error]}
    </p>
  );
}

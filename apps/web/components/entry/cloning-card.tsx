import { cn } from "cn";

import { Button } from "@/components/ui/button";

/**
 * The handoff's cloning card (`docs/design/README.md` "1. Entry", state 3a):
 * a status header with a real elapsed counter and a cancel, the four clone
 * steps, and an indeterminate bar.
 *
 * `POST /projects` is a single request with no progress events, so the card
 * never claims progress it cannot know: every step is pending, the first is
 * marked active, and the bar sweeps rather than fills (ruling in
 * docs/plans/phase-3-web-shell.md, "Design handoff").
 */
const STEPS = [
  "Fetch page",
  "Inline stylesheets",
  "Sanitise & tag elements",
  "Inject preview bridge",
] as const;

/** 12px in the header, 18px beside a step; both are the handoff's ring. */
function Ring({ spinning, className }: { spinning?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-full border-2 border-vm-surface-sunken",
        spinning && "border-t-vm-accent motion-safe:animate-spin",
        className,
      )}
    />
  );
}

export function CloningCard({
  label,
  elapsedSeconds,
  slowHint,
  onCancel,
}: {
  /** Host and path of the page being cloned, as the handoff labels it. */
  label: string;
  elapsedSeconds: number;
  /** The build plan's cold-start hint, once the clone has run long enough. */
  slowHint: boolean;
  onCancel: () => void;
}) {
  return (
    <section
      aria-label="Cloning"
      className="flex flex-col overflow-hidden rounded-2xl border border-vm-border bg-vm-surface shadow-card"
    >
      <div className="flex items-center gap-2.5 border-b border-vm-divider px-4 py-3 text-sm">
        <Ring spinning className="size-3" />
        <span role="status" className="min-w-0 truncate font-semibold">
          Cloning {label}
        </span>
        {/* Announced once; the seconds would otherwise retread the live region
            every tick. */}
        <span aria-hidden="true" className="shrink-0 text-vm-ink-2">
          · {elapsedSeconds} s
        </span>
        <Button
          type="button"
          variant="link"
          onClick={onCancel}
          className="ms-auto text-vm-ink-2 hover:text-vm-ink"
        >
          Cancel
        </Button>
      </div>

      <div className="flex h-[300px] items-center justify-center bg-[#fafafa]">
        <div className="flex w-[360px] flex-col gap-3.5 text-md">
          <ol className="flex flex-col gap-3.5">
            {STEPS.map((step, index) => {
              const active = index === 0;
              return (
                <li
                  key={step}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-3",
                    active ? "font-semibold" : "text-vm-ink-3",
                  )}
                >
                  <Ring spinning={active} className="size-[18px]" />
                  <span className="flex-1">{step}</span>
                </li>
              );
            })}
          </ol>
          <div
            role="progressbar"
            aria-label="Clone progress"
            className="mt-1.5 h-[3px] overflow-hidden rounded-[2px] bg-vm-surface-sunken"
          >
            <div className="h-full w-2/5 rounded-[2px] bg-vm-accent motion-safe:animate-vm-indeterminate" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-vm-divider px-4 py-3 text-sm text-vm-ink-2">
        <span>Pages over 10 MB or behind a login can’t be cloned.</span>
        {slowHint ? <span>Still cloning — large pages can take up to 15 seconds.</span> : null}
      </div>
    </section>
  );
}

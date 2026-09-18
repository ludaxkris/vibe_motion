import { useId } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { OTHER_CLONE_FAILURE_REASONS, type CloneFailure } from "./clone-failure";

/**
 * The handoff's error line (`docs/design/README.md` "1. Entry", state 3b):
 * "!" then a bold reason and a muted way out, on one wrapped line under the
 * URL row.
 */
export function CloneFailureNotice({
  id,
  failure,
}: {
  id: string;
  failure: Pick<CloneFailure, "headline" | "detail">;
}) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-2 text-md leading-[1.45] text-vm-danger"
    >
      <span aria-hidden="true" className="font-bold">
        !
      </span>
      <span>
        <span className="font-semibold">{failure.headline}</span>{" "}
        <span className="text-vm-ink-2">{failure.detail}</span>
      </span>
    </p>
  );
}

/** The 2×2 card under the message: the reasons this particular failure was not. */
export function OtherCloneFailureReasons() {
  const labelId = useId();

  return (
    <section
      aria-labelledby={labelId}
      className="flex flex-col gap-2.5 rounded-2xl border border-vm-border bg-vm-surface p-4 text-sm leading-body text-vm-ink-2"
    >
      <SectionLabel id={labelId}>Other reasons a clone can fail</SectionLabel>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5">
        {OTHER_CLONE_FAILURE_REASONS.map((reason) => (
          <div key={reason.term}>
            <dt className="inline font-medium text-vm-ink">{reason.term}</dt>{" "}
            <dd className="inline">— {reason.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

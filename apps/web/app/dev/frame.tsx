import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * One labelled frame in a `/dev` showcase, at the real width of what is in it.
 *
 * Shared by `/dev`, `/dev/history` and `/dev/export` (DT-186): the three pages
 * grew their own copies only because the branches that added them could not
 * edit each other's files. `data-testid="dev-frame-<slug>"` is the handle both
 * the screenshot runner and `apps/e2e/web/mocked/*` use, so it has to stay one
 * shape.
 */
export function Frame({
  slug,
  title,
  note,
  bodyClassName = PANEL_FRAME,
  children,
}: {
  /** The screenshot runner's handle: `data-testid="dev-frame-<slug>"`. */
  slug: string;
  title: string;
  note?: string;
  /** The frame's real width — {@link PANEL_FRAME}, 320px, for a Control Panel state. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={`dev-frame-${slug}`} className="flex flex-col gap-2">
      <h3 className="text-md font-semibold">{title}</h3>
      {note ? <p className="max-w-[46ch] text-sm leading-body text-vm-ink-2">{note}</p> : null}
      <div data-dev-frame-body="" className={cn("shrink-0 overflow-hidden", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** The 320px column a Control Panel state lives in, panel background included. */
export const PANEL_FRAME = "w-[var(--panel-width)] bg-vm-panel p-3";

/**
 * {@link PANEL_FRAME} for a panel that fills its height — the Export tab's code
 * block only has a height to scroll inside one, which in the editor comes from
 * the panel column (`components/control-panel/index.tsx`).
 */
const TALL_PANEL_FRAME = `flex h-[560px] flex-col ${PANEL_FRAME}`;

/** {@link Frame} at {@link TALL_PANEL_FRAME}, so the height is written once. */
export function TallFrame(props: Omit<Parameters<typeof Frame>[0], "bodyClassName">) {
  // Spread first: the height is this wrapper's to decide, and that holds
  // whatever `props` grows to carry.
  return <Frame {...props} bodyClassName={TALL_PANEL_FRAME} />;
}

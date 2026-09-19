"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import type { CatalogEntry } from "@/lib/api-client";
import { catalogInlineStyle } from "@/lib/catalog";
import { defaultsLine } from "@/lib/catalog-defaults";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * How long an exit demo rests on its end state before the stage is handed
 * back. Long enough to read "it is gone", short enough that the gallery is
 * not full of empty boxes.
 */
export const EXIT_HOLD_MS = 600;

/**
 * The one category whose end state is the absence of the element. Read from
 * the catalog's own `category`, never from an animation id: which animations
 * are exits is the catalog's to say, and a new one joins without a change
 * here (CLAUDE.md, "add a params entry rather than special-casing an
 * animation in code").
 */
const CATEGORY_THAT_LEAVES_NOTHING = "exit";

/**
 * One animation on `/help` (`docs/design/README.md` "4. Help",
 * `docs/design/ui_kit/Help.jsx`): a 120px stage with the accent block, a ↻
 * mini button, the animation's name and its defaults.
 *
 * The block runs the entry's *real* keyframes — the same CSS the editor
 * applies and the exporter ships — so this page doubles as a visual test of
 * the catalog. The `@keyframes` themselves are emitted once, on the server, by
 * `app/help/page.tsx`; this only sets the `animation-*` properties.
 *
 * Every card plays once on mount, whatever its `defaultTrigger`: the page is a
 * gallery, and a third of the catalog sitting still is not one. Entries that
 * default to `hover` additionally replay when the stage is hovered or its ↻
 * takes focus. An `exit` entry rests on its end state for `EXIT_HOLD_MS` and
 * then takes the animation off, since that end state is an empty stage; every
 * other category keeps whatever its animation left behind.
 *
 * A replay mounts a fresh block rather than rewriting `animation-name` on the
 * live one: React stays the only writer of the block's style, so a hover and a
 * ↻ landing in the same frame cannot race each other.
 */
export function CatalogCard({
  entry,
  catalogVersion,
  replayToken = 0,
}: {
  entry: CatalogEntry;
  /** The version the demo is pinned to; picks the `@keyframes` name. */
  catalogVersion: string;
  /** Bumped by "↻ Replay all"; any change replays this card. */
  replayToken?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();

  /** Bumping this mounts a new block, which starts the animation from zero. */
  const [run, setRun] = useState(0);
  /** This run was asked for (↻), rather than being autoplay or a hover. */
  const [requested, setRequested] = useState(false);
  /** The run is over and the stage has been handed back: no animation at all. */
  const [idle, setIdle] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaysOnHover = entry.defaultTrigger === "hover";
  const leavesNothingBehind = entry.category === CATEGORY_THAT_LEAVES_NOTHING;

  const cancelHold = useCallback(() => {
    if (holdTimer.current === null) return;
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  const replay = useCallback(
    (explicit: boolean) => {
      cancelHold();
      setIdle(false);
      setRequested(explicit);
      setRun((previous) => previous + 1);
    },
    [cancelHold],
  );

  // Nothing may fire into a card that has gone.
  useEffect(() => cancelHold, [cancelHold]);

  const runEnded = () => {
    if (!leavesNothingBehind) {
      setRequested(false);
      return;
    }
    // An exit animation fills forwards onto nothing, so the stage would stay
    // empty. Rest on that for a beat — it is what the animation does — then
    // hand the block back, ready to be played again.
    cancelHold();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setIdle(true);
      // Dropped only now: while it holds, the run stays exempt from the
      // reduced-motion rule that would otherwise cut the end state short.
      setRequested(false);
    }, EXIT_HOLD_MS);
  };

  // "Replay all" reaches every card through this token, and counts as asking:
  // pressing it is as explicit as pressing one card's own ↻.
  const mountedToken = useRef(replayToken);
  useEffect(() => {
    if (replayToken === mountedToken.current) return;
    replay(true);
  }, [replayToken, replay]);

  const demoStyle = idle ? undefined : catalogInlineStyle(entry, catalogVersion);
  // An animation the user asked to see should end by itself, however many
  // times the catalog would repeat it.
  if (demoStyle && reducedMotion && demoStyle.animationIterationCount === "infinite") {
    demoStyle.animationIterationCount = "1";
  }

  return (
    <li
      data-testid="catalog-card"
      className="flex flex-col gap-2.5 rounded-xl border border-vm-border bg-vm-surface p-3"
    >
      <div
        data-testid="catalog-card-stage"
        // The entry's own `hover` trigger, standing in for hovering the
        // element on the page. Focus rides along so the demo is not
        // mouse-only: React's focus events bubble, so the ↻ button inside
        // replays the card it belongs to when it is tabbed to.
        onMouseEnter={replaysOnHover ? () => replay(false) : undefined}
        onFocus={replaysOnHover ? () => replay(false) : undefined}
        className="relative flex h-[120px] items-center justify-center rounded-md bg-vm-panel"
      >
        <span
          key={run}
          data-testid="catalog-card-demo"
          // Read by the reduced-motion rule in the page's own stylesheet
          // (components/help/reduced-motion.ts): a block plays for someone who
          // asked for less motion only while it is marked as asked for.
          data-vm-demo=""
          data-vm-replayed={requested ? "" : undefined}
          onAnimationEnd={runEnded}
          className="block h-[38px] w-16 rounded-md bg-vm-accent"
          style={demoStyle as CSSProperties | undefined}
        />

        {replaysOnHover ? (
          // Hidden for a reader who asked for less motion: hovering is not an
          // explicit request, so it does not play for them, and a hint that
          // does nothing is worse than none.
          <span className="absolute bottom-2 left-2 text-xs text-vm-ink-2 motion-reduce:hidden">
            Hover or focus to replay
          </span>
        ) : null}

        <Button
          variant="secondary"
          size="xs"
          glyph="↻"
          glyphTone="ink"
          aria-label={`Replay ${entry.name}`}
          onClick={() => replay(true)}
          // The handoff's mini button is off the control-height scale: 11px
          // type in a 2/7 box with a 5px radius (ui_kit/Help.jsx).
          className="absolute right-2 bottom-2 h-auto rounded-[5px] px-[7px] py-0.5 text-xs font-normal"
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-md font-semibold">{entry.name}</span>
        <span className="font-mono text-xs font-normal text-vm-ink-2">{defaultsLine(entry)}</span>
      </div>
    </li>
  );
}

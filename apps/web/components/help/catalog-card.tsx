"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import type { CatalogEntry } from "@/lib/api-client";
import { catalogInlineStyle } from "@/lib/catalog";
import { defaultsLine } from "@/lib/catalog-defaults";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * One animation on `/help` (`docs/design/README.md` "4. Help",
 * `docs/design/ui_kit/Help.jsx`): a 120px stage with the accent block, a ↻
 * mini button, the animation's name and its defaults.
 *
 * The block runs the entry's *real* keyframes — the same CSS the editor
 * applies and the exporter ships — so this page doubles as a visual test of
 * the catalog. The `@keyframes` themselves are emitted once, on the server, by
 * `app/help/page.tsx`; this only sets the `animation-*` properties.
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
  const blockRef = useRef<HTMLSpanElement>(null);

  /** An entry that only makes sense while pointed at waits to be pointed at. */
  const onDemand = entry.defaultTrigger === "hover";
  const [hovering, setHovering] = useState(false);
  /** A play the user asked for: it outranks both reduced motion and the trigger. */
  const [requested, setRequested] = useState(false);

  const playing = requested || (!reducedMotion && (onDemand ? hovering : true));

  const replay = useCallback(() => {
    const block = blockRef.current;
    if (!block) return;

    // Whether anything is running is written on the block itself, so the
    // replay reads it there rather than from state it would have to mirror.
    const name = block.style.animationName;
    if (!name || name === "none") {
      setRequested(true);
      return;
    }

    // A re-render cannot restart an animation — the value it would write is
    // the value already there. Dropping the name ends the run; restoring it on
    // the next frame, after the style has been recomputed, starts a new one.
    block.style.animationName = "none";
    requestAnimationFrame(() => {
      block.style.animationName = name;
    });
  }, []);

  // "Replay all" reaches every card through this token, hover-trigger cards
  // included: pressing it is as explicit as pressing one card's own ↻.
  const mountedToken = useRef(replayToken);
  useEffect(() => {
    if (replayToken === mountedToken.current) return;
    replay();
  }, [replayToken, replay]);

  const demoStyle = playing ? (catalogInlineStyle(entry, catalogVersion) as CSSProperties) : undefined;

  return (
    <li
      data-testid="catalog-card"
      className="flex flex-col gap-2.5 rounded-xl border border-vm-border bg-vm-surface p-3"
    >
      <div
        data-testid="catalog-card-stage"
        // Hovering the stage is the entry's own `hover` trigger, standing in
        // for hovering the element on the page. Focus rides along so the
        // demo is not mouse-only: React's focus events bubble, so the ↻
        // button inside plays the card it belongs to when it is tabbed to.
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className="relative flex h-[120px] items-center justify-center rounded-md bg-vm-panel"
      >
        <span
          ref={blockRef}
          data-testid="catalog-card-demo"
          // A hover demo ends where the hover would have ended it, so a
          // `forwards` fill does not leave the block parked off its mark.
          onAnimationEnd={() => setRequested(false)}
          className="block h-[38px] w-16 rounded-md bg-vm-accent"
          style={demoStyle}
        />

        {onDemand ? (
          <span className="absolute bottom-2 left-2 text-xs text-vm-ink-2">Hover to play</span>
        ) : null}

        <Button
          variant="secondary"
          size="xs"
          aria-label={`Replay ${entry.name}`}
          onClick={replay}
          // The handoff's mini button is off the control-height scale: 11px
          // type in a 2/7 box with a 5px radius (ui_kit/Help.jsx).
          className="absolute right-2 bottom-2 h-auto rounded-[5px] px-[7px] py-0.5 text-xs font-normal"
        >
          <span aria-hidden="true">↻</span>
        </Button>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-md font-semibold">{entry.name}</span>
        <span className="font-mono text-xs font-normal text-vm-ink-2">{defaultsLine(entry)}</span>
      </div>
    </li>
  );
}

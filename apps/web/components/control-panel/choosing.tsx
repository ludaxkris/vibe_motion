"use client";

import { useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ElementTag } from "@/components/ui/element-tag";
import { Input } from "@/components/ui/input";
import type { CatalogEntry } from "@/lib/api-client";
import {
  ALL_CATEGORIES,
  CURRENT_CATALOG_VERSION,
  catalogCategories,
  catalogKeyframes,
  categoryLabel,
  getCatalogEntries,
} from "@/lib/catalog";

import { AnimationCard } from "./animation-card";
import { PanelCard, PanelSection } from "./panel-card";

/**
 * The animation picker (`docs/design/README.md` "2. Editor", choosing): a
 * search field, the category chips, and a 2-column grid of `AnimationCard`s
 * whose demos play the catalog's real keyframes.
 *
 * Presentational and fully controlled — search and category come in as props
 * so `/dev` (Task 9) can render "choosing" and "choosing with empty search"
 * without a store.
 */
export function ChoosingPanel({
  vmId,
  entries = getCatalogEntries(),
  catalogVersion = CURRENT_CATALOG_VERSION,
  appliedAnimationId,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  onPick,
  onBack,
}: {
  /** The element being animated; shown as the header's tag. */
  vmId: string;
  entries?: readonly CatalogEntry[];
  catalogVersion?: string;
  /** The animation already on this element, highlighted in the grid. */
  appliedAnimationId?: string;
  search: string;
  onSearchChange?: (search: string) => void;
  /** A catalog category, or `ALL_CATEGORIES`. */
  category: string;
  onCategoryChange?: (category: string) => void;
  onPick?: (animationId: string) => void;
  onBack?: () => void;
}) {
  // The highlight *is* the focused card (roving focus): a second copy of
  // "which card the arrows are on" could disagree with the one the user can
  // see, and an Enter resolved from the copy would apply an animation the
  // focused control knows nothing about. It also means the highlight is gone
  // the moment focus leaves the grid, with nothing to clear.
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (category === ALL_CATEGORIES || entry.category === category) &&
          (!query || entry.name.toLowerCase().includes(query)),
      ),
    [entries, category, query],
  );

  // One `@keyframes` block per visible entry, injected once: the cards then
  // only have to set `animation-*` to play the real thing.
  const keyframes = useMemo(
    () => catalogKeyframes(visible.map((entry) => [entry, catalogVersion] as const)),
    [visible, catalogVersion],
  );

  /** Where in the grid an event came from, or -1 when it came from elsewhere. */
  const cardIndexOf = (target: EventTarget | null): number =>
    cardRefs.current.findIndex((card) => card !== null && card === target);

  const focusCard = (index: number) => {
    cardRefs.current[index]?.focus();
  };

  /**
   * ↑↓ move the highlight and Enter applies it — for the grid, and only for
   * the grid. The handler sits on the grid `<div>` *and* checks that the key
   * came from one of its cards, so a key pressed on the search field, a
   * category chip or the back control is never swallowed on its way to the
   * control the user is actually standing on.
   */
  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = cardIndexOf(event.target);
    if (index < 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      // Stops at the ends rather than wrapping: the grid is a list of what the
      // search left, not a carousel.
      focusCard(Math.min(visible.length - 1, Math.max(0, index + delta)));
      return;
    }

    if (event.key === "Enter") {
      // Also cancels the focused card's own Enter activation, so an applied
      // animation is applied exactly once.
      event.preventDefault();
      onPick?.(visible[index].id);
    }
  };

  /**
   * ArrowDown steps out of the search field and into the list, the way a
   * filter over a list conventionally does. Every other key stays the field's
   * — ArrowUp, ArrowLeft and ArrowRight move the caret, which is the whole
   * point of a text field.
   */
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowDown" || visible.length === 0) return;
    event.preventDefault();
    focusCard(0);
  };

  return (
    <PanelCard data-testid="panel-choosing">
      <style>{keyframes}</style>

      <PanelSection className="h-11 flex-row items-center gap-2 py-0">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back"
          glyph="‹"
          onClick={onBack}
          className="-ml-1.5 text-lg"
        />
        <span className="flex-1 text-md font-semibold">Choose animation</span>
        <ElementTag size="sm">{vmId}</ElementTag>
      </PanelSection>

      <PanelSection>
        <Input
          type="search"
          size="sm"
          aria-label="Search animations"
          placeholder="Search animations"
          prefix="⌕"
          // The handoff's field is the glyph and the text, nothing else;
          // WebKit's own clear button would be a second, unstyled control.
          className="[&_input::-webkit-search-cancel-button]:appearance-none"
          value={search}
          onChange={(event) => onSearchChange?.(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />

        <div className="flex flex-wrap gap-1.5">
          <Chip
            pressed={category === ALL_CATEGORIES}
            onClick={() => onCategoryChange?.(ALL_CATEGORIES)}
          >
            All
          </Chip>
          {catalogCategories(entries).map((name) => (
            <Chip
              key={name}
              pressed={category === name}
              onClick={() => onCategoryChange?.(name)}
            >
              {categoryLabel(name)}
            </Chip>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="py-2 text-sm text-vm-ink-2">
            No animations match &ldquo;{search.trim()}&rdquo;.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2" onKeyDown={handleGridKeyDown}>
            {visible.map((entry, index) => (
              <AnimationCard
                key={entry.id}
                ref={(element) => {
                  cardRefs.current[index] = element;
                }}
                entry={entry}
                catalogVersion={catalogVersion}
                applied={entry.id === appliedAnimationId}
                onApply={() => onPick?.(entry.id)}
              />
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection>
        <p className="flex items-center gap-1.5 text-xs text-vm-ink-2">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-vm-accent" />
          Hover a card to preview on the page · click to apply
        </p>
      </PanelSection>
    </PanelCard>
  );
}

"use client";

import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ElementTag } from "@/components/ui/element-tag";
import { Input } from "@/components/ui/input";
import type { CatalogEntry } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, catalogKeyframes, getCatalogEntries } from "@/lib/catalog";

import { AnimationCard } from "./animation-card";
import { PanelCard, PanelSection } from "./panel-card";

/** The chip that is not a category: everything. */
export const ALL_CATEGORIES = "all";

function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Catalog order, deduplicated — the chip row follows the catalog, not a fixed list. */
function categoriesOf(entries: readonly CatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.category))];
}

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
  // Which card the arrow keys last moved to, by id rather than by index: the
  // visible list changes under it as the search and the category change.
  const [highlightId, setHighlightId] = useState<string | null>(null);
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

  const highlightIndex = visible.findIndex((entry) => entry.id === highlightId);

  const moveHighlight = (delta: 1 | -1) => {
    if (visible.length === 0) return;
    const next =
      highlightIndex < 0
        ? delta > 0
          ? 0
          : visible.length - 1
        : Math.min(visible.length - 1, Math.max(0, highlightIndex + delta));
    setHighlightId(visible[next].id);
    cardRefs.current[next]?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && highlightIndex >= 0) {
      // Also cancels the focused card's own Enter activation, so an applied
      // animation is applied exactly once.
      event.preventDefault();
      onPick?.(visible[highlightIndex].id);
    }
  };

  return (
    <PanelCard data-testid="panel-choosing" onKeyDown={handleKeyDown}>
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
        />

        <div className="flex flex-wrap gap-1.5">
          <Chip
            pressed={category === ALL_CATEGORIES}
            onClick={() => onCategoryChange?.(ALL_CATEGORIES)}
          >
            All
          </Chip>
          {categoriesOf(entries).map((name) => (
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
          <div className="grid grid-cols-2 gap-2">
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
                onFocus={() => setHighlightId(entry.id)}
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

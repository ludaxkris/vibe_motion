"use client";

import { useId, useState } from "react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { CatalogEntry } from "@/lib/api-client";
import { ALL_CATEGORIES, catalogCategories, categoryLabel } from "@/lib/catalog";

import { CatalogCard } from "./catalog-card";

/**
 * One line per category, in the handoff's voice (Entrance and Attention are
 * its own words, from `docs/design/ui_kit/Help.jsx`).
 *
 * The catalog has no per-category description, so this map lives in the web
 * app for now; it belongs beside the categories themselves, in a later catalog
 * version, so that a new category cannot arrive without one (reported as a
 * deferred item).
 */
export const CATEGORY_BLURBS: Readonly<Record<string, string>> = {
  entrance: "Plays once when the element loads or scrolls into view.",
  exit: "Plays once as the element leaves.",
  attention: "Draws the eye without moving the element far.",
  emphasis: "Marks the element where it stands.",
  continuous: "Loops for as long as the element is on the page.",
  hover: "Plays while the pointer is on the element.",
};

/**
 * `/help` — every animation in the current catalog as a live card
 * (`docs/design/README.md` "4. Help", `docs/design/ui_kit/Help.jsx`).
 *
 * The page is a visual test of the catalog: the cards play the catalog's own
 * keyframes, at the catalog's own defaults, resolved by the same
 * `lib/runtime-css` the editor and the exporter use. Nothing here is written
 * per animation, so a new catalog version shows up whole — new categories and
 * new params included.
 */
export function HelpScreen({
  entries,
  catalogVersion,
}: {
  entries: readonly CatalogEntry[];
  catalogVersion: string;
}) {
  const headingId = useId();
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  /** Any change replays every card on the page; "↻ Replay all" bumps it. */
  const [replayToken, setReplayToken] = useState(0);

  const query = search.trim().toLowerCase();
  const found = entries.filter((entry) => !query || entry.name.toLowerCase().includes(query));

  // The chips count what the search left, so a chip's number is always what
  // pressing it would show — and a chip with nothing behind it is not offered.
  const categories = catalogCategories(entries).map((name) => ({
    name,
    count: found.filter((entry) => entry.category === name).length,
  }));
  const visible = found.filter(
    (entry) => category === ALL_CATEGORIES || entry.category === category,
  );
  const sections = categories
    .map(({ name }) => ({
      name,
      entries: visible.filter((entry) => entry.category === name),
    }))
    .filter((section) => section.entries.length > 0);

  return (
    <>
      <TopBar title="Animations" titleTone="full" chip={`catalog ${catalogVersion}`} />

      {/* The help page's own surface is white, not the editor's canvas
          (`ui_kit/Help.jsx`), so the cards read as outlines on it. */}
      <main className="flex min-h-0 flex-1 flex-col bg-vm-surface pb-12">
        {/* The screen's name is in the bar, which is a banner and so cannot
            carry the page's heading. */}
        <h1 className="sr-only">Animation catalog</h1>

        <div className="flex items-center gap-1.5 px-12 pt-4">
          <Chip
            pressed={category === ALL_CATEGORIES}
            disabled={found.length === 0}
            onClick={() => setCategory(ALL_CATEGORIES)}
          >
            All {found.length}
          </Chip>
          {categories.map(({ name, count }) => (
            <Chip
              key={name}
              pressed={category === name}
              disabled={count === 0}
              onClick={() => setCategory(name)}
            >
              {categoryLabel(name)} {count}
            </Chip>
          ))}

          <Input
            type="search"
            size="sm"
            aria-label="Search animations"
            placeholder="Search"
            prefix="⌕"
            // The handoff's field is the glyph and the text, nothing else;
            // WebKit's own clear button would be a second, unstyled control.
            className="ml-auto w-60 [&_input::-webkit-search-cancel-button]:appearance-none"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            glyph="↻"
            glyphTone="ink"
            onClick={() => setReplayToken((token) => token + 1)}
          >
            Replay all
          </Button>
        </div>

        {/* Rendered for everyone and revealed by the media query, never by a
            hook: the demos are held still by CSS before any JavaScript runs
            (components/help/reduced-motion.ts), so the note has to arrive the
            same way or it would trail the thing it explains. */}
        <p className="hidden px-12 pt-2 text-sm text-vm-ink-2 motion-reduce:block">
          Your system asks for reduced motion, so nothing plays on its own. Replay a card to see
          it move.
        </p>

        <div className="flex flex-col gap-3.5 px-12 pt-6">
          {sections.length === 0 ? (
            <p className="text-md text-vm-ink-2">
              No {category === ALL_CATEGORIES ? "" : `${category} `}animations match &ldquo;
              {search.trim()}&rdquo;.
            </p>
          ) : (
            sections.map((section, index) => (
              <section
                key={section.name}
                aria-labelledby={`${headingId}-${section.name}`}
                className={index === 0 ? "flex flex-col gap-3.5" : "mt-2.5 flex flex-col gap-3.5"}
              >
                <div className="flex items-baseline gap-2.5">
                  <h2
                    id={`${headingId}-${section.name}`}
                    className="text-lg font-semibold tracking-[-0.01em]"
                  >
                    {categoryLabel(section.name)}
                  </h2>
                  <p className="text-sm text-vm-ink-2">{CATEGORY_BLURBS[section.name]}</p>
                </div>

                <ul className="grid grid-cols-4 gap-3.5">
                  {section.entries.map((entry) => (
                    <CatalogCard
                      key={entry.id}
                      entry={entry}
                      catalogVersion={catalogVersion}
                      replayToken={replayToken}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </main>
    </>
  );
}

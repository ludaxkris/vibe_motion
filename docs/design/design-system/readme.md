# Vibe Motion — Design System

Vibe Motion is a desktop web tool that lets product designers add CSS animations to an existing web page: clone a page by URL, click a component, auto-generate or pick an animation from a catalog, tune it live, keep version history, export HTML/CSS/JS. Stack (planned): Next.js 15 + Tailwind + shadcn/ui on the web, Kotlin/Ktor API, Postgres.

## Sources
- Local codebase `vibe_motion/` (planning-only at time of writing: `README.md`, `CLAUDE.md`, `docs/user_flow.md`, `docs/architecture.md`, `docs/build_plan.md`). No application code, no logo, no icon set existed.
- Design work in this project: `Vibe Motion Wireframes.dc.html` (turn 1), `Vibe Motion Hi-fi.dc.html` (turns 2–4), `Vibe Motion Prototype.dc.html` (working PoC). The system below is derived from hi-fi option **4b “Brand”**: deep-violet top bar carrying project, version, Save/Cancel; lavender panel with a white tabbed card; the cloned page floats as a white sheet on a lavender canvas.

## Products / surfaces
One product, three surfaces: **Entry** (`/` — URL, clone preview, recent projects), **Editor** (`/p/{id}` — 44px violet top bar; below it a 75% cloned page floating as a sheet on a lavender canvas and a 320px control panel with Animate · History · Export tabs), **Help** (`/help` — every catalog animation as a live card).

## Content fundamentals
- Voice: calm, direct, second person. “Click any element to animate it.” “Save to keep it as a new version, or discard to leave v5 as is.” Never exclamation marks, never marketing adjectives.
- Sentence case everywhere, including buttons (“Choose custom animation”, “Open in editor →”). Section labels are the one exception: 11px uppercase with 0.04em tracking (“TRIGGER”, “SELECTED”).
- Technical identifiers are literal and monospace: element tags (`h1`, `a.cta`, `.plan:2`), version numbers (`v5`), values with units (`600 ms`, `24 px`), CSS (`vm-fade-in-up-v1`). Units are separated from the value and set in the faint ink.
- Version labels are auto-generated from the diff and human-readable: “Fade In Up on h1, Pulse on .cta”; removals read “removed Pulse on .cta”.
- Explanatory captions are 11px muted, one or two short sentences, placed directly under the control they explain. No tooltips for primary explanations.
- Destructive actions are text links in danger red (“Remove animation”, “Discard”), never filled buttons.
- No emoji. The only glyphs are unicode: ✦ (agent / generate), ↻ (replay), ‹ (back), ▾ (menu), ⌕ (search), › (drill in), ✓ (done), ∞ (infinite).

## Visual foundations
- **Colour.** Lavender-tinted greys on three levels: canvas `#ecebf5` → panel `#f3f1fb` → white card/sheet, topped by a deep-violet bar `#221b45` with white text. Ink `#1d1d1f`; muted and faint inks are violet-grey (`#7a7392`, `#a89fc9`) rather than neutral. One accent, violet `#7c5cff` (`#8f74ff` on the dark bar, `#4a35b8` for active tab/segment text), reserved for: selection rings and tags, slider fill and thumb ring, the primary action, focus rings, the unsaved dot, active tab text, and text links. Semantic green/orange/red appear only as diff signs, status dots and error text. The cloned page keeps its own colours and is never tinted.
- **Type.** System sans (SF Pro / Helvetica Neue stack). UI body 13px, captions 11–12px, dialog titles 15px semibold, entry headline 34px bold with −0.03em tracking. Monospace (Menlo/ui-monospace) for identifiers and numeric values. No display serif, no webfonts to load.
- **Spacing & radii.** 2px base grid in controls (2/4/6/8/10/12/14/16/20/24). Panel padding 12–16px. Radii: 6px inputs, 8px buttons and segmented controls, 10–12px cards, 14px dialogs, pill for chips and floating banners. Tabs are folder tabs attached to the white panel card.
- **Surfaces.** A 44px `#221b45` top bar spans the editor: wordmark · divider · project URL · version chip · unsaved dot, then Help, Cancel (outlined white 25%) and Save (`#8f74ff`) on the right. Below, the cloned page floats as a white sheet with 10px top radii and a violet-tinted shadow, inset 16px from the lavender canvas. The panel holds one white card with the active tab attached to its top edge (tab folder style, 8px top radii, hairline `#dcd8ee` border); sections inside are separated by `#ecebf5` dividers.
- **Borders & shadows.** Hairline `#dcdce2` borders on panel edges; `#d2d2d7` on inputs; `#ececf0` dividers inside cards. Shadows are cool and low-contrast; the Save button carries a violet glow (`--shadow-accent`). Modals sit on a 32% ink scrim with a 60px shadow.
- **Selection.** Selected element: 2px solid violet ring offset 6px with matching radius, plus a violet mono tag at top-left (“h1 · Fade In Up”). Hover: 1.5px dashed violet ring at 80% opacity, no tag. Nothing else on the cloned page is recoloured.
- **Controls.** Slider: 4px lavender track (`#e6e2f7`), violet fill, 14px white thumb with a 1.5px violet ring; always paired with a 62×28 mono number field showing unit in faint ink. Segmented: 2px padding, selected segment white with 1px shadow. Chips: pill, 12px, filled ink when selected, hairline otherwise.
- **States.** Hover: ink darkens one step / accent to `--vm-accent-hover`. Pressed: `--vm-accent-pressed`, no scale. Disabled: 40% opacity. Focus: 3px violet soft ring. Unsaved: 7px violet dot + “Unsaved” caption replaces the version badge.
- **Motion.** Chrome moves little: 150–250ms standard easing for panel state changes, toast slides up 8px over 250ms. Animation previews on the page are the product — they use the catalog’s own keyframes (prefixed `vm-`) and replay by re-triggering the animation, never by re-rendering the page.
- **Layout.** Desktop only. Editor: 44px top bar, then a fixed 75/25 split (panel 320px at 1280 wide). Panel: folder tabs → white card (scrolling body). Save and Cancel live in the top bar so they are never scrolled away; the panel has no footer. Entry is a two-column grid (1.35fr / 1fr) with 120px side gutters.
- **Imagery.** None. No illustrations, no photography, no gradients. Placeholders for recent-project thumbnails are grey line skeletons.

## Iconography
No icon system was defined in the source. The mocks use unicode glyphs only (listed above) set in the same sans as the surrounding text, 12–16px. If an icon font is adopted later, Lucide (1.5px stroke, 16/20px) matches the stroke weight of the mocks and the shadcn/ui stack; this is a recommendation, not a decision. There is **no logo** — the wordmark is the product name in 15px/700 sans with −0.02em tracking; nothing was invented.

## Intentional additions
- `SelectionRing` and `ElementTag` — the on-page selection affordance, needed by the editor but not a conventional UI primitive.
- `AnimationCard` — catalog picker card with the hover-to-preview behaviour.

## Index
- `styles.css` — entry point (imports only)
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `motion.css`
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Surfaces, Motion)
- `components/core/` — Button, Input, NumberField, Slider, Segmented, Tabs, Chip, ElementTag, VersionBadge, SectionCard, Dialog, Toast, AnimationCard, VersionRow, SelectionRing (+ `.d.ts`, `.prompt.md`, card HTML)
- `ui_kits/editor/` — Entry, Editor, Help screens composed from the components (`index.html` switches between them)
- `SKILL.md` — Agent Skills entry for Claude Code
- `deferred_tasks_additions.md` — DT-020/021 rows for the repo’s deferred log

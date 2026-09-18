# Handoff: Vibe Motion — Entry, Editor, Help (v0)

## Overview
Vibe Motion lets a designer clone a public web page by URL, click an element in the clone, auto-generate or pick a CSS animation from a versioned catalog, tune it live, save versions, and export HTML/CSS/JS. This package covers the web app's three v0 surfaces: **Entry** (`/`), **Editor** (`/p/[projectId]`), **Help** (`/help`), plus the Control Panel state machine and dialogs. It maps onto Phase 3–4 of `docs/build_plan.md` in the `vibe_motion` repo (Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, Zustand, TanStack Query; iframe bridge via postMessage).

## About the design files
Everything in this bundle is a **design reference written in HTML/JSX** — prototypes that show intended look and behaviour, not production code to paste in. Recreate them in `apps/web` using its established stack: Tailwind for styling (map the tokens below to `tailwind.config` / CSS variables in `globals.css`), shadcn/ui primitives where they fit (Button, Input, Tabs, Dialog, Slider, ToggleGroup, Badge), Zustand for editor state, the generated API client for data. The cloned page lives in a cross-origin iframe served by the API — the "ClonedPage" JSX here is only a stand-in.

## Fidelity
**High-fidelity.** Recreate pixel-perfectly: colours, type, spacing, radii and states below are final. The `design-system/` folder is the source of truth for values; the `ui_kit/` screens show them composed; the `prototype/` shows the intended interaction feel (a self-contained HTML file — open it in a browser).

## Global chrome
- **Top bar** — 44px, `#221b45`, white text. Left→right: wordmark "Vibe Motion" (13px/700, −0.02em) · 1px divider (white 25%) · project host+path (13px/500, white 85%) · version chip `v5` (mono 11px, white 12% bg, 4px radius) · unsaved indicator (7px `#b39dff` dot + "Unsaved" 11px) when dirty. Right: "Help" (12px) · **Cancel** (28px, 7px radius, 1px white-25% border, 12px/500) · **Save** (28px, 7px radius, `#8f74ff`, 12px/600). Cancel/Save are 40% opacity when there are no unsaved changes.
- **Canvas** — `#ecebf5`. Editor body below the bar is a flex row: preview (flex 1) + panel (320px fixed). Desktop only, min 1280 wide. Panel resize is **out of v0** (DT-020).
- **Font** — system stack `-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, system-ui, sans-serif`; mono `ui-monospace, Menlo, Consolas, monospace`. No webfonts.

## Screens

### 1. Entry — `/`
Purpose: paste a URL, watch the clone, open the editor; or reopen a recent project.
- Layout: top bar (wordmark left, "Help ↗" right). Body: grid `1.35fr 1fr`, gap 56, padding `36px 120px 60px`.
- Left column (gap 20): headline "Animate any page." + second line "Paste a URL to clone it." (34px/700, −0.03em, line 1.1; second line `#7a7392` weight 500). URL row: Input xl (44px, 10px radius, 1px `#dcd8ee`, white, prefix "https://" in `#a89fc9`, 14px) + **Clone** button (44px, 10px radius, `#1d1d1f`, 14px/600).
- Clone card (white, 1px `#dcd8ee`, 14px radius): status row (12px; green 8px dot `#34c759`; "Cloned" bold; "42 elements tagged · 3 stylesheets inlined · 1.2 MB" muted; "1440 × 2130" right) · 300px scaled preview of the clone (`#fafafa` bg) · footer: "Scripts removed · links absolutized" (12px muted) · **Try another URL** (secondary 36px) · **Open in editor →** (primary 36px, `#7c5cff`, violet glow shadow).
- Right column: "Recent projects" (13px/600) + "View all" (12px muted). List card (white, 1px `#dcd8ee`, 14px radius): rows 12/14 padding, 56×38 thumbnail (`#eeebfa`, 1px border, 6px radius), name 13px/500, meta 11px muted ("v5 · Pulse on .cta · 2h ago"), "Open" 12px/500 `#7c5cff`. Caption under list, 11px `#a89fc9`.
- **Cloning state** (`3a`): Clone button 40% opacity; card header shows spinner (12px ring, violet top) + "Cloning nimbus.app/pricing · 4 s" + "Cancel"; body lists four steps — Fetch page ✓ (184 KB · 1 redirect), Inline stylesheets ✓ (3 of 3), Sanitise & tag elements (spinner, bold), Inject preview bridge (pending, faint) — with a 3px progress bar (62% violet). Footer caption "Pages over 10 MB or behind a login can't be cloned." Recent column at 50% opacity. Open button disabled.
- **Error state** (`3b`): input gets 1.5px `#d0342c` border + `rgba(208,52,44,.12)` 3px glow; button reads **Retry**; below: "!" + bold "Couldn't clone this page — it redirected to a sign-in screen." + muted explanation. A white card lists other reasons (Unreachable · Too large · Blocked host · Not HTML) in a 2-col grid. URL is kept in the field.

### 2. Editor — `/p/[projectId]`
Purpose: select an element in the clone, add/tune an animation, save versions, export.
- Preview: padding `16px 16px 0`; the iframe sits in a white sheet, radii `10px 10px 0 0`, shadow `0 10px 36px rgba(34,27,69,.16)`. The iframe's own page keeps its colours — never tint it.
- Panel: `#f3f1fb`, 1px left border `#dcd8ee`. **Folder tabs** at top (`12px 12px 0` padding, gap 2): Animate · History · Export; active tab white with 1px `#dcd8ee` border (bottom border white), radii `8px 8px 0 0`, 12px/600 `#4a35b8`; inactive 12px `#7a7392`; while unsaved the inactive tabs are `#cfc9e6` and clicking them triggers the guard. Below: **one white card** (1px `#dcd8ee`, radii `0 10px 10px 10px`, margin `0 12px`) whose sections are 14px-padded and separated by 1px `#ecebf5`. Panel caption at bottom (11px muted): "Save and Cancel live in the top bar so they're never scrolled away."

Control Panel is a state machine: `idle → selected → choosing → tuning` (+ `auto` result list).
- **idle** — section 1 (centred): 44px dashed-border square with violet "+", "Click any element to animate it" (13/600), "Hover outlines the element. Press Esc to deselect." (12 muted; Esc as mono kbd chip). Section 2: label WHOLE PAGE; prompt textarea (1px `#dcd8ee`, 8px radius, ≥56px, placeholder "Describe the feel — 'calm, staggered entrances, nothing loops'"); secondary button "✦ Auto-generate for this page" (✦ in violet); caption explaining it. If assignments exist: label "ANIMATED · n" and rows (tag chip 52px mono · name 13/500 · meta 11 muted "load · 600ms · 0ms" · "›"), then "↻ Replay all".
- **selected** — label SELECTED; violet mono tag (`#7c5cff` bg, white, 12px, 3/8 padding, 6px radius) + truncated element text (12 muted); "No animation yet · Esc to deselect" (11 faint). Label ADD ANIMATION; **✦ Auto-generate for this element** (primary 40px) and **Choose custom animation** (secondary 40px).
- **choosing** — header 44px: "‹" back · "Choose animation" (13/600) · selected tag. Search Input sm (34px, ⌕ prefix, placeholder "Search animations"). Category chips (pill, 12px, selected = `#1d1d1f` fill; else 1px `#dcd8ee` border): All · Entrance · Attention · Emphasis · Continuous · Hover. 2-col grid (gap 8) of **AnimationCard**: 1px border, 10px radius, 8px padding, 16:10 demo box (`#f3f1fb`) with a 30×18 violet block, name 12/500. Hovered/previewing or currently applied: 1.5px `#7c5cff` border + 3px `rgba(124,92,255,.15)` ring, demo bg `#f3f0ff`. Empty search: "No animations match "q"." Footer caption with violet dot: "Hover a card to preview on the page · click to apply".
- **tuning** — Section 1: tag + animation name (13/600) + "Change" link (12/500 violet); label TRIGGER + segmented On load / On hover / In view. Section 2 (gap 14): **Slider rows** — label 56px 12px muted · track 4px `#e6e2f7` with violet fill · 14px white thumb with 1.5px violet ring · **NumberField** 62×28 (1px `#dcd8ee`, 6px radius, mono 12/500 right-aligned, unit in `#a89fc9` 11px). Rows: Duration (100–3000, step 50, ms), Delay (0–2000, step 50, ms), Distance (0–200, px; only if the catalog entry has `distance`), Scale (0.5–1.5, step .01, ×; only if it has `scale`), Easing (select, mono; options ease, ease-out, ease-in, ease-in-out, linear, spring = `cubic-bezier(.34,1.56,.64,1)`; 62px preview box showing the curve), Repeat (dense segmented 1 / 2 / 3 / ∞). Section 3: "↻ Replay" (secondary 30px) left; "Remove animation" (red text link `#d0342c`) right. Focused NumberField: 1px violet border + 3px violet ring.
- **auto-generate result** (`2k`): "✦ Generated 5 animations" + "Regenerate" link; quoted prompt + summary; rows per assignment (h1 · Fade In Up · load · 600ms · 0ms / .plan ×3 · Slide In Up · stagger 120ms / a.cta · Pulse · hover · 400ms · once); caption "Click a row to tune it, or click the element on the page. Skipped: nav, logos row (too small to matter)."; "↻ Replay all" · "Remove all". Badges on the page elements show the assigned animation (pill, violet, 10px).
- **History tab** — list of VersionRow: `v5 Pulse on .cta — Current · 2h ago` (bg `#f3f1fb`), `v4 …`, … `v0 Cloned — Mon · 42 elements`. Viewing a version: row gets 3px violet left rule + `#f3f0ff` bg, expands with a mono diff block ("+ h1 · fade-in-up · load / 600ms · ease-out · 24px", green +) and **Restore** (primary 30px) + **Export v3** (secondary). Preview dims (white 45% overlay) and a floating black pill banner (top centre, 12px, radius 999, shadow) reads "Viewing **v3** · read-only" with **Restore as v6** (violet pill) and **Back to v5** (outlined). Controls in Animate are disabled while viewing. Removed entries render "− Pulse on .cta" with red minus. Footer caption: "Restoring creates a new version — v4 and v5 stay in the list."
- **Export tab** — label EXPORTING + "v5 · current" (mono v); segmented Full page / Snippet; caption "Full page replaces the HTML. Snippet gives CSS + class names to paste into your existing site."; file tabs (mono 11px: index.html · vibe-motion.css active on `#1d1d1f` · vibe-motion.js faint if unused); code block (`#1d1d1f`, `#d4d4d8` text, 10.5px/1.6 mono, radii `0 8px 8px 8px`, "Copy" pill top-right white 10%); footer "2 animations · 4 elements · js not needed (no in-view triggers)"; **Copy all** (secondary) · **Download .zip** (ink 36px).

### 3. Dialogs & toast
- **Unsaved guard** (`2g`) — 380px, white, 14px radius, 22px padding, shadow `0 20px 60px rgba(34,27,69,.3)` on scrim `rgba(34,27,69,.4)`. Title "Save changes to h1?" (15/600). Body 13px muted: "You changed **Fade In Up** on this element but haven't saved. Save to keep it as a new version, or discard to leave v5 as is." Actions: **Discard** (red text, left) · **Keep editing** (secondary) · **Save** (primary). Triggered by: clicking another element, switching tab, opening History/Export, Export/Restore while dirty.
- **Save dialog** (`2h`) — 420px. Title "Save as v6" + "from v5" (12 muted). Label LABEL + text input prefilled from the diff ("Fade In Up on h1, Pulse on .cta"), focused (violet border + ring). Label CHANGES IN THIS VERSION + list: sign (+ green / ~ orange / − red) · mono tag chip · name · meta right ("600ms · ease-out · 24px", "trigger load → hover"). Actions right: **Cancel** (secondary) · **Save version** (primary).
- **Toast** — bottom-centre black pill, 12px/500, "Saved v6" / "Copied CSS"; slides up 8px over 250ms; auto-dismiss ~2 s.

### 4. Help — `/help`
Top bar variant (wordmark · divider · "Animations" · "catalog 1.0.0" chip). Row: chips All 12 · Entrance 4 · Attention 3 · Emphasis 2 · Continuous 2 · Hover 1; search (240px) and "↻ Replay all" right. Sections per category: title 15/600 + one-line blurb (12 muted). 4-col grid (gap 14) of cards: 1px border, 12px radius, 12px padding, 120px demo box (`#f3f1fb`, 8px radius, 64×38 violet block, "↻" mini button bottom-right), name 13/600, defaults in mono 11 muted ("600ms · ease-out · distance 24px"). Each card mounts the real catalog keyframes with defaults and replays on ↻.

## On-page selection (inside the iframe, via vm-bridge.js)
- Hover: 1.5px **dashed** `#7c5cff` ring, 80% opacity, no label.
- Selected: 2px solid `#7c5cff` ring, offset ≈6px outside the element (radius follows the element), mono tag top-left (`#7c5cff` bg, white, 11px/500, 2/7 padding, radii `4px 4px 0 0`) reading `h1`, `h1 · Fade In Up`, or `h1 · previewing Slide In Left`.
- Cursor over the clone is crosshair. Esc deselects (only when clean). Clicking the background deselects when clean; when dirty it does nothing.

## Interactions & behaviour
- Slider drag / number typing / segmented change → update draft in store → `apply` postMessage same frame (no network). Mark unsaved.
- Hover an AnimationCard → `apply` a preview with catalog defaults; leave → clear preview; click → set assignment, go to tuning.
- Replay → re-trigger the animation without re-render (prototype alternates between two identical keyframe aliases; production can toggle the class or use `animation-name` swap).
- Trigger "On hover" applies the animation only while the element is hovered in the preview.
- Save → Save dialog → POST version (diff) → toast, unsaved cleared, History gains an entry. 409 → rebase/discard dialog (not designed yet — reuse the guard dialog layout).
- Cancel → draft reverts to current version state; mode returns to tuning/selected based on whether the element still has an assignment.
- Keyboard: Esc deselect; ↑↓ move highlight in the picker list and preview; Enter applies.
- Chrome motion: 150ms for hovers/segment changes, 250ms `cubic-bezier(.2,0,0,1)` for panel state changes. Disabled = 40% opacity. No press scale.

## State (Zustand store)
`mode: 'idle'|'selected'|'choosing'|'tuning'`, `tab: 'animate'|'history'|'export'`, `selectedVmId`, `hoverVmId`, `previewAnimationId`, `draftState: Record<vmId, Assignment>`, `currentVersionState`, `unsaved = !deepEqual(draft, current)`, `viewingVersionId | null`, `guard: (() => void) | null`, `saveDialogOpen`, `saveLabel`, `toast`, `search`, `category`. `Assignment = { animationId, catalogVersion, trigger, params: { duration, delay, easing, iteration, distance?, scale? } }`.

## Design tokens
See `design-system/tokens/*.css` (authoritative). Key values:
- Bar `#221b45` · bar accent `#8f74ff` · bar dot `#b39dff` · canvas `#ecebf5` · panel `#f3f1fb` · card `#ffffff` · control bg `#eeebfa` · track `#e6e2f7` · border `#dcd8ee` · divider `#ecebf5`
- Ink `#1d1d1f` · muted `#7a7392` · faint `#a89fc9` · disabled `#cfc9e6`
- Accent `#7c5cff` · strong `#4a35b8` · hover `#6b4de6` · pressed `#5b3fd0` · soft `rgba(124,92,255,.15)` · tint `#f3f0ff`
- Success `#34c759` · warning `#ff9f0a` · danger `#d0342c` · scrim `rgba(34,27,69,.4)`
- Type: 11 / 12 / 13 / 15 / 34 / 48 px; weights 400/500/600/700; label = 11px/600 uppercase +0.04em
- Spacing: 2 4 6 8 10 12 14 16 20 24 48 · radii 4 6 8 10 12 14 pill · control heights 28 30 36 40 44 · panel 320 · top bar 44 · canvas inset 16
- Shadows: sheet `0 10px 36px rgba(34,27,69,.16)` · card `0 1px 2px rgba(0,0,0,.04)` · raised `0 1px 2px rgba(34,27,69,.12)` · popover `0 6px 20px rgba(0,0,0,.2)` · modal `0 20px 60px rgba(34,27,69,.3)` · accent glow `0 4px 12px rgba(124,92,255,.35)` · focus ring `0 0 0 3px rgba(124,92,255,.15)`

## Copy rules
Sentence case (buttons too); labels uppercase; identifiers/values in mono; destructive actions are red text links; no emoji; glyphs only: ✦ ↻ ‹ ▾ ⌕ › ✓ ∞ !.

## Assets
None. No logo (wordmark is plain type), no icon set (unicode glyphs). If an icon library is adopted, Lucide 1.5px stroke matches.

## Files in this package
- `design-system/` — tokens (`styles.css` → `tokens/`), `readme.md` (foundations + content rules), `SKILL.md`, `guidelines/` specimen cards, `components/core/` reference components (.jsx/.d.ts/.prompt.md)
- `ui_kit/` — `index.html` + Entry/Editor/Help/TopBar/ClonedPage JSX (open index.html over a local static server; it loads React from esm.sh)
- `mocks/` — hi-fi mock source (`Vibe Motion Hi-fi.dc.html`, all turns/states) and the interactive PoC (`Vibe Motion Prototype.dc.html`); both need the sibling `support.js` and `Cloned Pricing Page.dc.html` and must be served over HTTP (e.g. `npx serve mocks`). The states they show are fully described above, so reading them is optional.
- `deferred_tasks_additions.md` — DT-020 (panel resize) and DT-021 (dark theme) rows for `docs/deferred_tasks.md`

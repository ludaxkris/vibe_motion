# Vibe Motion — Build Plan (v0)

Status: DRAFT for review · Owner: Chris Tung · Last updated: 2026-09-18

Vibe Motion lets a product designer load an existing web page, click a component, and attach a CSS animation to it, either by asking a (mock) agent to pick one or by choosing from a catalog and tuning its parameters live. Every change is versioned and can be restored. The result is exported as HTML, CSS, and JS the designer can drop into their site.

This document describes how we get to v0. Each phase lists the deliverable, the critical decisions inside it, the recommended choice, and the exit criteria. Sequencing constraints are called out in section 3.

Companion documents:

- [Architecture diagram](architecture.md) — mermaid views of the system
- [User flow](user_flow.md) — designer's journey from URL to export, in mermaid
- [Deferred tasks and bugs](deferred_tasks.md)
- [Shared agent memory](../memory.md)
- [Agent instructions](../CLAUDE.md)

---

## 1. Scope

### In scope for v0

| Requirement | Where it lands |
|---|---|
| Enter a URL, clone the page to a local copy we render and modify | Phase 2 (API clone service), Phase 3 (web) |
| Version history: the user clicks Save to create a version; clicking a version reloads that state | Phase 6 |
| CSS-only animations | Phase 1 (catalog) |
| Export HTML, JS, CSS the user can copy | Phase 7 |
| Help page listing every animation with a live demo | Phase 3 |
| Click a component: it is highlighted, the Control Panel appears with Generate and Custom | Phases 4 and 5 |
| Custom shows the list of available animations | Phase 5 |
| Selecting an animation exposes its adjustable variables | Phase 5 |
| Variable changes update the preview in real time | Phase 4 |
| Mock agent randomly picks from the catalog | Phase 5 |
| Auto-generate for the whole page | Phase 5 |
| Split layout: 70–80% preview, 20–30% control panel | Phase 3 |
| Hosted on Render: web, api, database | Phase 0 |

### Explicitly out of scope for v0 (logged in deferred_tasks.md)

- Figma or PNG ingestion and design-to-code conversion
- A real LLM-backed agent (the mock agent is built behind an interface so this is a swap, not a rewrite)
- JS-driven or scroll-driven animations, Web Animations API, GSAP, Lottie
- Authentication, multi-user projects, sharing
- Multi-page sites (one URL = one page = one project)

---

## 2. Technology decisions (project-wide)

The user constraint is Kotlin, Next.js, and Postgres unless there is a strong reason otherwise. There is not. The decisions below are within that constraint.

| Decision | Choice | Alternatives considered | Why |
|---|---|---|---|
| Repo shape | Single monorepo: `apps/web`, `apps/api`, `packages/animation-catalog`, `docs/` | Two repos | One Render blueprint, one CI, shared catalog file, atomic cross-stack PRs. Multiple agents in worktrees work best against one repo. |
| Kotlin framework | Ktor 3 + kotlinx.serialization + Exposed + Flyway, JDK 21, Gradle Kotlin DSL | Spring Boot 3 | Ktor keeps the image small and startup fast on Render's starter plan, and v0's API surface is small (projects, versions, clone, export). Spring Boot is the fallback if we need its ecosystem; the repository layer is isolated so the switch stays local. |
| Next.js | Next.js 16, App Router, TypeScript, Tailwind 4, shadcn/ui (Base UI), Node 22 | Pages Router, Vite SPA | App Router is the current default. The preview page and help page are mostly client components. |
| Database | Render managed Postgres 16, Flyway migrations owned by the API | Prisma from Next.js | One owner of the schema. The web app never talks to the DB directly. |
| Storage of cloned pages | Postgres `text` column (single HTML document per project, assets inlined or absolutized) | Render disk, S3 | v0 stores one HTML document per project, typically under a few MB. No object store to provision. Revisit if we start storing binary assets (deferred). |
| Frontend/API boundary | The web app calls the API over HTTPS with a typed client generated from the API's OpenAPI document | Hand-written fetch wrappers | Contract-first lets Phase 2 and Phase 3 run in parallel against the same spec. |
| Animation catalog | Versioned, immutable JSON files in `packages/animation-catalog/versions/<semver>.json` plus a `current` pointer, validated by a JSON Schema, consumed by web (TS types generated) and api (kotlinx.serialization) | Single mutable file; TS-only catalog | Single source of truth for the control panel, help page, mock agent, and exporter. Immutability means a saved animation always re-renders exactly as the designer saw it (see Phase 1). |
| What a saved animation is | A reference: `{ animationId, catalogVersion, trigger, params }`. CSS is **derived**, never stored. | Store generated CSS per version | Diffs stay tiny and readable; CSS is a pure function of the pinned catalog entry plus params, so it is always reproducible. Pinning the catalog version removes the only way that function could change. |
| Package manager | pnpm workspaces for JS, Gradle for Kotlin | npm, Turborepo | pnpm is fast and handles the web + catalog workspace. Turborepo is unnecessary at two JS packages. |
| Tests | Vitest + React Testing Library (web unit), Kotest + Testcontainers (api), Playwright (e2e) | Jest, JUnit only | Standard, fast, and each subagent role maps to one of these. |
| Hosting | Render blueprint: `web` (Node), `api` (Docker), Postgres | Vercel for web | User requirement. See `render.yaml`. |

---

## 3. Phase map and sequencing

```
Phase 0  Foundation ─────────────┐
                                 ├──> Phase 1  Animation catalog ──┐
                                 ├──> Phase 2  API core            ├──> Phase 4  Selection bridge + live preview ──> Phase 5  Mock agent + Control Panel flows ──> Phase 6  Version history ──> Phase 7  Export ──> Phase 8  Hardening + launch
                                 └──> Phase 3  Web shell + help ───┘
```

| Phase | Depends on | Can run in parallel with | Why it is sequential (or not) |
|---|---|---|---|
| 0 Foundation | nothing | nothing | Everything else needs the repo, CI gates, and the API contract. |
| 1 Animation catalog | 0 | 2, 3 | Pure data + schema. Only needs the repo. |
| 2 API core (projects, clone, versions) | 0 | 1, 3 | Builds against the OpenAPI contract frozen in Phase 0. |
| 3 Web shell + help page | 0 | 1, 2 | Builds against the same contract using a mocked API (MSW) until Phase 2 lands. Help page uses catalog fixtures until Phase 1 lands. |
| 4 Selection bridge + live preview | 1, 2, 3 | nothing | Needs a real cloned page from the API, the shell to host it, and the catalog to render. This is the integration point. |
| 5 Mock agent + Generate/Custom flows | 4 | 6 (partially) | Control Panel behavior sits on top of the bridge. |
| 6 Version history + restore | 2, 4 | 5 | API side can start after Phase 2; UI side needs the bridge to replay state. |
| 7 Export | 1, 6 | nothing | Export composes base HTML + version state + catalog. Must wait for the final shape of version state. |
| 8 Hardening + launch | 5, 6, 7 | nothing | e2e suite, Render production deploy, smoke tests. |

Parallelism plan for agents: after Phase 0 merges, three worktrees can run at once (1, 2, 3). Phase 4 is a single-agent integration task. Phases 5 and 6 can run as two worktrees. Phase 7 and 8 are single-agent.

---

## 4. Phases in detail

### Phase 0 — Foundation

Deliverable: a repo that a new agent can clone, run gates on, and deploy, with the API contract frozen enough for Phases 2 and 3 to proceed independently.

Tasks

1. Monorepo scaffold: `apps/web` (Next.js), `apps/api` (Ktor), `packages/animation-catalog`, `docs/`.
2. `render.yaml` blueprint with web, api, and Postgres. PR preview environments are off (decided by Chris, 2026-09-18, after the first sync: one full stack per PR was cost without a consumer); e2e runs locally against Docker instead.
3. Dockerfile for the API (multi-stage Gradle build, JRE 21 runtime).
4. GitHub Actions gates: lint, typecheck, unit tests (web + api), build, e2e smoke. A failing gate applies the `Gate Flag` label and comments on the PR.
5. OpenAPI 3.1 document at `apps/api/openapi.yaml` covering projects, clone, versions, export. Generated TS client in `apps/web`.
6. Flyway baseline migration: `projects`, `versions`.
7. CLAUDE.md, memory.md, deferred_tasks.md, subagent definitions (this planning pass).

Critical decisions

- **Contract first.** The OpenAPI file is the interface between two parallel worktrees. Changing it after Phase 0 requires updating memory.md and pinging both worktrees. Recommended: yes, freeze it, allow additive changes only.
- **How the preview iframe reaches the cloned page.** Options: (a) web proxies `/preview/:projectId` to the API via a Next.js rewrite so the iframe is same-origin with the shell, or (b) iframe points at the API origin directly and all communication is `postMessage`. Recommended: (b) postMessage with a strict origin check. It works identically in local dev, Render previews, and production, and it keeps the cloned page's scripts out of the shell's origin. Same-origin access to the iframe DOM is a security and stability liability when the cloned page is arbitrary third-party HTML.
- **Where the database schema lives.** Recommended: Flyway in the API. The web app has no DB access.

Exit criteria: `pnpm gates` and `./gradlew check` pass in CI on an empty-feature repo; blueprint deploys three services to Render (verified 2026-09-18 on the production environment).

### Phase 1 — Animation catalog

Deliverable: `packages/animation-catalog/versions/1.0.0.json` with 20–30 CSS animations, a JSON Schema, a `current` pointer, generated TS types, a Kotlin loader that round-trips every published version, and the immutability gate.

Package layout

```
packages/animation-catalog/
  schema.json              # JSON Schema for a catalog file
  versions/1.0.0.json      # immutable once merged to main
  versions/1.1.0.json      # each change is a new file
  current                  # text file containing the semver the editor authors against
  CHANGELOG.md             # one entry per version: added / changed / removed, and why
  scripts/gen-types.ts     # TS types + a `CATALOGS` map keyed by version
  scripts/check-immutable.ts  # CI gate, see below
```

Each catalog file carries `"version": "1.0.0"` at the top and an `entries` array.

Catalog entry shape (draft):

```json
{
  "id": "fade-in-up",
  "name": "Fade In Up",
  "category": "entrance",
  "keyframes": "@keyframes vm-fade-in-up { from { opacity: 0; transform: translateY(var(--vm-distance)); } to { opacity: 1; transform: none; } }",
  "params": [
    { "key": "duration",  "type": "duration", "default": "600ms", "min": "100ms", "max": "5000ms" },
    { "key": "delay",     "type": "duration", "default": "0ms" },
    { "key": "easing",    "type": "easing",   "default": "ease-out" },
    { "key": "iteration", "type": "iteration","default": "1" },
    { "key": "distance",  "type": "length",   "default": "24px", "cssVar": "--vm-distance", "min": "0px", "max": "200px" }
  ],
  "trigger": ["load", "hover", "in-view"]
}
```

Categories: entrance, exit, attention (pulse, shake, bounce), emphasis (glow, color shift), continuous (spin, float), hover.

Critical decisions

- **Common params vs animation-specific params.** Every animation gets the standard `animation-*` properties (duration, delay, easing, iteration, direction, fill-mode). Animation-specific knobs (distance, scale, angle) are exposed as CSS custom properties referenced inside the keyframes. Recommended: yes. This is what makes live updates cheap: the preview only sets style properties on the element, never regenerates keyframes.
- **Triggers in v0.** `load` (runs on page load), `hover`, and `in-view` (IntersectionObserver, requires the exported JS). Recommended: ship all three. `in-view` is the only reason the export includes JS; without it the export would be HTML + CSS only.
- **Naming.** All generated class names, keyframes, and custom properties are prefixed `vm-` to avoid collisions with the host page. Keyframe names include the full catalog version (`vm-fade-in-up-v1-1-0`), not just the major, so `(animationId, catalogVersion)` — already the immutable identity of a keyframes template — is the name by construction: two assignments authored under different catalog versions can never collide, even within the same major. `keyframesName(animationId, version)` is derived by one function per language (`packages/animation-catalog/src/index.ts`, `apps/api/.../catalog/Keyframes.kt`); it is never stored or parsed, and it throws on a version that is not a strict `MAJOR.MINOR.PATCH` semver. (Decided by Chris, 2026-09-18; see DT-047.)
- **Catalog files are immutable; every change is a new version.** (Decided by Chris, 2026-09-18.) Once a `versions/<semver>.json` file is merged to `main` it is never edited again, not even for typos. Any change, additive or breaking, is a new file plus a `current` bump plus a CHANGELOG entry. Semver signals intent: **patch** = metadata only; **minor** = new animations, or new params (standard or cssVar-backed) whose default reproduces the previous rendering — this may add `var(--vm-x)` references to keyframes/baseStyles; **major** = changed rendering at default params, removed animations, renamed or removed params. The rule is enforced by `check-immutable.ts` in CI: it hashes every `versions/*.json` on the PR against `origin/main` and fails if any file that exists on `main` differs. Only new files and `current` may change. A separate superset gate (`pnpm --filter animation-catalog validate`) enforces the part of this that's mechanically checkable: within a shared major, no animation id and no param key on a shared id may ever be dropped going forward. It does not and cannot check that a minor's new default reproduces the previous rendering — that half of the contract is a review responsibility.
- **Saved assignments pin the catalog version.** Every assignment written into a version diff carries `catalogVersion`. The preview runtime and the exporter resolve each assignment against exactly that catalog file, so a project saved under 1.0.0 renders identically after the catalog reaches 3.0.0. The API and web bundle every published catalog version (they are small JSON files). Moving an existing assignment to a newer catalog version is an explicit user action ("Upgrade to latest") and is deferred to DT-019.
- **The editor authors against `current`.** The Custom list, the help page, and the mock agent all read the `current` catalog. Older versions are load-only: they are never shown as choices, only used to render what was already saved.

Exit criteria: schema validates every catalog file in CI; `check-immutable` gate passes and is proven to fail on a fixture edit; a test renders every entry's keyframes in every published version through a CSS parser without error; Kotlin and TS both load all versions and agree on the set of `(version, animationId)` pairs.

### Phase 2 — API core

Deliverable: Ktor service exposing the OpenAPI contract with Postgres persistence.

Endpoints (draft)

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects` | `{ url }` → clones the page, creates project + version 0, returns project |
| GET | `/projects/{id}` | Project metadata and current version pointer |
| GET | `/projects/{id}/page` | Serves the cloned HTML with the bridge script injected. This is the iframe `src`. |
| GET | `/projects/{id}/versions` | Version list |
| POST | `/projects/{id}/versions` | Save: append a version `{ parentVersionId, diff, label }`. Rejected with 409 if `parentVersionId` is not the project's current version. |
| GET | `/projects/{id}/versions/{vid}/state` | Materialised full state at `vid` (server replays diffs from v0) |
| POST | `/projects/{id}/versions/{vid}/restore` | Creates a new version whose diff brings the current state back to `vid`'s state (history is never rewritten) |
| GET | `/projects/{id}/export?versionId=` | Returns `{ html, css, js }` |
| GET | `/catalog` | Serves the `current` catalog (so web and api provably agree) |
| GET | `/catalog/versions` | Lists published catalog versions |
| GET | `/catalog/{version}` | Serves one published catalog version |

Data model

```
projects   (id uuid pk, source_url text, base_html text, title text, created_at, current_version_id uuid)
versions   (id uuid pk, project_id fk, parent_version_id uuid null, seq int, label text,
            catalog_version text, diff jsonb, created_at)
```

`catalog_version` on the row records which catalog the editor was authoring against when the user saved. It is informational (history list, debugging). The authoritative pin is inside each assignment.

A project's *state* is the full animation assignment map for the page: `{ "<vmId>": { animationId, catalogVersion, trigger, params } }`. It is never stored directly. Each version stores a `diff` against its parent:

```json
{ "set": { "vm-17": { "animationId": "fade-in-up", "catalogVersion": "1.0.0", "trigger": "load",
                      "params": { "duration": "600ms", "distance": "24px" } } },
  "remove": ["vm-42"] }
```

State at version N = fold every diff from v0 (empty state) through N, applying `set` then `remove`. Version 0 is the empty diff.

**Where the CSS is.** Nowhere in the database. `(animationId, catalogVersion)` identifies an immutable keyframes template; `params` fills its knobs. The preview runtime and the exporter both run the same deterministic generator over that pair, so the CSS is reproducible forever without being stored. The API validates on save that every `catalogVersion` in the diff is a published version and every `animationId` exists in it, and rejects with 422 otherwise.

Critical decisions

- **Clone strategy.** Server-side fetch of the URL, parse with jsoup, then: inject `data-vm-id` on every element under `<body>` (deterministic, depth-first counter), rewrite relative `src`/`href`/`srcset`/`url()` to absolute, inline `<link rel=stylesheet>` contents where fetchable, strip `<script>` tags, inline event handlers and `javascript:` URLs (see next decision). Store the result as `base_html`. Recommended: this, with a 10 MB cap and a 15 s fetch timeout. Headless browser rendering (Playwright) would capture JS-rendered pages but is heavier to run on Render and is deferred.
- **The bridge and the CSP are added at serve time, not at clone time.** (Revised in Phase 2.) `base_html` is immutable, so baking the bridge `<script>` into it would pin every project to the bridge version that existed when it was cloned, and Phase 4+ protocol changes would break old projects. `GET /projects/{id}/page` runs a cheap string-level `PageRenderer` over `base_html` that adds the CSP (header + meta) and the `<script src="/bridge/vm-bridge.js">` tag configured with the allowed parent origin. The exporter reads `base_html` directly, so exports never contain the bridge.
- **Operational bounds (added after the Phase 2 architecture review).** One deadline (`CLONE_TIMEOUT_MS`) covers the whole clone: every hop, every stylesheet, body reads (a watchdog closes a stalled response stream) and the gaps between rewrite stages. At most **2 concurrent clones per instance**, because a worst-case 10 MB page peaks at roughly 110-140 MB of heap and a Render starter instance has about 300 MB usable; a third caller waits 5 s and then gets `503 clone_busy` with `Retry-After`. JSON request bodies are capped at 256 KB and a diff at 2,000 entries. The JVM DNS cache TTL is pinned to 60 s so the SSRF guard's lookup and the client's connect share one answer (narrows, does not close, DT-039). Every regex applied to fetched content is length-bounded.
- **Param values are validated, not just keys.** Each value in a saved assignment must match the type, range and unit declared by the param in the *pinned* catalog version, and may never contain CSS-structural characters or `url(` / `expression(` / `@import`. The exporter emits these values as CSS on the designer's site, so the API is the trust boundary. An API test validates the default of every param in every bundled catalog version, so a catalog release the validator cannot accept fails the API gate.
- **`base_html` must be safe without a CSP.** Exports read it directly, so anything that is only neutralised by the preview's CSP is removed at clone time instead: `ping`, SMIL animation of link attributes, HTML comments, and stylesheet links to hosts the SSRF guard refused.
- **Save and restore serialise on `SELECT ... FOR UPDATE` of the project row at READ COMMITTED**, with `lock_timeout = 3s` (`503 project_busy`). Transaction blocks are deliberately non-suspending so a transaction can never hop threads or wrap a network call.
- **The rendered page is revalidatable without reading `base_html`.** `ETag` = hash of project id + renderer fingerprint, `Cache-Control: private, no-cache`, `Referrer-Policy: no-referrer` (the project URL is a capability).
- **Third-party scripts.** Strip them. The designer is animating a static rendering, and third-party JS competing with our bridge for the DOM is the largest source of flakiness. Logged as deferred: an opt-in "keep scripts" mode.
- **Element identity.** `data-vm-id` assigned at clone time and stored in `base_html`. Because the base is immutable, IDs are stable across versions and exports. CSS selector generation is not needed.
- **Versions store diffs, created only on explicit Save.** (Decided by Chris, 2026-09-18.) Each version stores the delta from its parent, so the history stays small and each entry reads as "what changed". Materialising state is a fold over the project's diffs, done in one place (`VersionService.stateAt`) and used by the versions endpoint, restore, and the exporter. Replay cost is negligible at v0 scale (tens of assignments, hundreds of saves at most); a periodic checkpoint snapshot is logged as DT-017 in case a project ever grows past that. Restore appends a new version whose diff is `delta(currentState, stateAt(vid))` rather than moving a pointer backward, so history stays linear and auditable. Saves carry `parentVersionId`; the API rejects a stale parent with 409 so two tabs cannot fork the history silently.
- **Unsaved work is a client-side draft.** Between saves, the editor holds a working state in the Zustand store and mirrors it into the iframe. Nothing reaches the API until Save. The editor shows an "unsaved changes" indicator and warns on navigation. Draft persistence to localStorage as a safety net is DT-016.
- **SSRF protection.** Resolve the hostname and reject private, loopback, link-local, and metadata ranges before fetching. Follow at most 3 redirects, re-checking each hop.

Exit criteria: Kotest integration suite against Testcontainers Postgres covers every endpoint; property test that `stateAt(N)` equals folding the diffs and that `diff(a, b)` applied to `a` yields `b`; cloning three real public pages (a marketing page, a docs page, a dashboard-style page) produces renderable HTML.

### Phase 3 — Web shell and help page

Deliverable: the Next.js app with routing, the split layout, a URL entry screen, an empty Control Panel, and the help page, all against a mocked API.

Routes

| Route | Purpose |
|---|---|
| `/` | Enter a URL → POST /projects → redirect to editor |
| `/p/[projectId]` | Editor: 75% preview iframe, 25% Control Panel (resizable, clamped 20–30%) |
| `/help` | Every catalog animation as a live card with a replay button and default params |

Critical decisions

- **State management.** Editor state (selected element, current version state, dirty params) in a single Zustand store. Server state via TanStack Query with the generated client. Recommended: yes. Redux is overkill; React context alone gets tangled once the bridge, panel, and version list all read the same state.
- **Control Panel is a state machine.** States: `idle` (nothing selected) → `selected` (Generate / Custom buttons) → `choosing` (catalog list) → `tuning` (param controls). Recommended: encode explicitly (XState or a hand-written reducer). This prevents the panel showing param controls with no animation chosen.
- **Help page renders from the catalog, not from screenshots.** Each card mounts a sample box and applies the animation with its default params using the same runtime CSS generator the editor uses. This means the help page is also a visual test of the catalog.
- **Mocks.** MSW handlers implementing the OpenAPI contract so the shell is fully clickable before the API exists.

Exit criteria: Storybook or a `/dev` route demonstrates all Control Panel states; help page renders every catalog entry; Playwright smoke test loads `/` and `/help`.

### Phase 4 — Selection bridge and live preview (integration)

Deliverable: clicking an element in the iframe highlights it and opens the Control Panel; adjusting a param updates the element within one frame.

Bridge protocol: **[docs/plans/phase-4-bridge-protocol.md](plans/phase-4-bridge-protocol.md) is the contract**, and it is where the message table, the payload shapes and the origin checks live. It refines what this section sketched: every shell→iframe message carries a `seq` and is answered with `ack { seq, ms, ok }`, the handshake carries `protocolVersion` and is re-openable with `hello`, `preview` / `preview:clear` are separate from `apply` / `clear`, and `apply` carries finished CSS rather than an animation id — the bridge never reads the catalog. The script itself is a workspace package, `packages/bridge`, which both the api jar and the web mock route serve.

| Direction | Types |
|---|---|
| iframe → shell | `ready` · `element:hover` · `element:select` · `element:deselect` · `ack` |
| shell → iframe | `hello` · `select` · `apply` · `clear` · `replay` · `preview` · `preview:clear` · `state:load` |

Critical decisions

- **How the preview applies an animation.** The bridge script maintains a single `<style id="vm-runtime">` block containing the `@keyframes` for every animation currently in use, and sets per-element inline `style` properties: `animation-name`, `animation-duration`, and the `--vm-*` custom properties. Param changes only touch inline styles, so live updates are cheap and never re-parse keyframes. Recommended: yes. Replay sets `animation-name: none`, forces a **synchronous** style flush (`getComputedStyle(el).animationName`) and restores the name, all in the same task — not a next-frame toggle, which the browser is free to coalesce into no change at all. The bridge receives the keyframes name (`vm-<id>-v<M>-<m>-<p>`) from the shell/shared `keyframesName()` generator and never builds it itself.
- **Live preview never writes to the API.** Slider moves update the iframe immediately and update the draft state in the store. No network call happens until the user clicks Save (Phase 6). This keeps the preview loop entirely client-side and means what a "version" is stays in the user's hands.
- **Hover/selection overlay.** Drawn inside the iframe by the bridge script (outline + label) rather than by the shell over the iframe, so it scrolls with the content and needs no coordinate translation.
- **Click interception.** The bridge captures clicks at the document level in the capture phase, calls `preventDefault`, and never lets links navigate. The clone is a canvas, not a browsable page.

- **Unsaved-changes guard on an element switch.** Clicking another element while the selected one has an added or changed animation opens the guard first, and the selection ring does not move until it is answered (spec §5, D10, owner decision §9.1).
- **Mock mode is cross-origin too.** The shell serves itself from one loopback name and frames the other (`localhost` ⇄ `127.0.0.1`), so a bridge that skipped its origin check could not pass e2e (spec §2).

Exit criteria: Playwright test loads a fixture page, clicks an element, changes duration, and asserts the inline style on the element inside the iframe; frame time for a param change under 16 ms measured in a perf test (`apps/e2e/web/mocked/bridge-perf.spec.ts`).

### Phase 5 — Mock agent and Control Panel flows

Deliverable: Generate, Custom, per-element tuning, and page-level Auto-generate.

Critical decisions

- **Agent interface.** `AnimationAgent { suggestForElement(context): Promise<Assignment>; suggestForPage(context): Promise<PageSuggestion> }` (async and vmId-keyed, `PageSuggestion = { assignments: Record<vmId, Assignment>; skipped }`, so the DT-003 swap to a server-side LLM changes no call site; as built in `apps/web/lib/agent`, details in `docs/plans/phase-5-agent-flows.md`) where context includes tag, role, text, size, position, and existing assignments. `MockAnimationAgent` picks randomly from the catalog (seeded so tests are deterministic), but respects light heuristics: headings and images prefer entrance animations, buttons prefer hover, and nothing gets `exit` on auto-generate. Recommended: implement the interface in the web app for v0 (no network hop needed for a random choice) but keep it pure so it can move server-side when a real LLM is behind it.
- **Auto-generate targets.** Which elements does page-level auto-generate touch? Recommended: only "semantic" elements (headings, paragraphs, images, buttons, links, cards), staggered by their document order with a 60 ms delay increment (capped at 600 ms). Animating every `<div>` is noise. **Revised during Phase 5 (2026-09-19), both found by the full-stack e2e:** (1) the size floor is **40 px wide × 16 px tall**, not 40×40: browser-default headings (h1 ≈ 37 px, h2 ≈ 28 px) and every one-line paragraph are under 40 px tall, so the original floor skipped exactly what Auto-generate is for; (2) **a container block (`article`, `figure`, `li`, `blockquote`) animates as one unit**: entrance targets fully inside it are skipped (they would otherwise stack three entrances per card under the container's held `opacity: 0`); links and buttons inside keep their hover animation; this holds for a block the designer animated by hand too, and an entrance element taller than the preview viewport is neither a target nor a block (`too-large`), so a wrapper around a whole article is skipped and its contents are judged on their own. The element list comes from the bridge (`elements:query`, tag/size pre-filter in the frame). **Ownership:** Auto-generate and Regenerate never overwrite hand-tuned work; they re-roll only assignments the agent made and the user has not touched (`generated` map in the store, client-only), and the element-switch guard ignores such untouched agent work.
- **Prompt input.** The spec's "agentic prompt" text box is present in v0 and passed into the mock agent's context but ignored by it. This keeps the UI complete and the mock honest about what it does (a tooltip and a line under the box say so). Page-level Auto-generate lands on a **result list** (handoff mock `2k`, without on-page badges or row grouping): one row per generated element, an "edited" tag once hand-tuned, Regenerate / Replay all / Remove all, and a "Skipped n elements" caption.

Exit criteria: e2e covers Generate, Custom → pick → tune, and Auto-generate on the fixture page; none of these flows creates a version on its own, and the unsaved indicator appears after each.

### Phase 6 — Version history and restore

Deliverable: a Save button and unsaved-changes indicator; a version list in the Control Panel; clicking a version reloads the preview at that state; restoring creates a new version.

Critical decisions

- **Save is explicit.** The Save button is enabled only when the draft differs from the current version's state. Save computes `diff(currentVersionState, draftState)` in the client, posts it with `parentVersionId`, and on 201 the draft becomes the new current version. A 409 (stale parent, e.g. another tab saved) opens a conflict dialog offering **"Apply my changes on top"** (the client replays its own diff onto the newer version's state, then reopens the Save dialog so the user confirms the second write — never an automatic retry) or **"Discard my changes"** (load the newer version).
- **Viewing vs restoring.** Clicking a version puts the editor in read-only "viewing v7" mode with that version's materialised state loaded into the iframe. Read-only is enforced in the store, not just the UI: while `mode === "viewing"`, every draft writer and element selection is refused. The preview is dimmed (a translucent overlay) and made `inert`, Save and Cancel are hidden from the top bar (not merely disabled), and pressing Esc or leaving the History tab returns to the current version. If there are unsaved changes, the user is asked to save or discard before viewing can start. A "Restore this version" button appends a new version whose diff returns the project to v7's state and re-enters editing. Recommended: yes. Silent branching or pointer moves confuse users and complicate export.
- **Labels.** The Save dialog offers an auto-generated label summarising the diff ("Fade In Up on h1, removed pulse on .cta") that the user can overwrite before saving. Editing labels after the fact is deferred (DT-006).
- **Base page is immutable.** Re-cloning a changed source URL is a new project, not a new version. Recorded so nobody adds "refresh source" to versions.
- **Project open.** Opening a project loads the current version's materialised state into the draft once; an edit made before that load lands is kept and replayed on top of it rather than being overwritten or discarded.

Exit criteria: e2e makes changes, asserts no version is created until Save, saves five times, clicks v2, asserts the iframe state matches `stateAt(v2)`, restores, asserts a v6 exists whose materialised state equals v2's; a second-tab save produces a 409 handled in the UI. Proven by `apps/e2e/web/stack/versions.spec.ts` under `pnpm e2e:docker` / `pnpm gates`.

### Phase 7 — Export

Deliverable: an Export panel with three tabs (HTML, CSS, JS), copy buttons, and a "Download .zip".

Output contract

- `vibe-motion.css`: `@keyframes` for every animation used + one rule group per assignment (`.vm-a1 { animation: ... }`) + custom property values. No inline styles in the exported HTML. Everything but the keyframes is inside `@media (prefers-reduced-motion: no-preference)`.
- `index.html`: the base clone with every `data-vm-id` removed and, on each assigned element, the class `vm-a<N>` **appended** to whatever classes the page already had (`data-vm-id="vm-17"` → `class="hero vm-a17"`). The class is *derived* from the id, not allocated, so it is stable across versions and a snippet pasted into a site last month still matches a full export made today; an element with an `in-view` assignment also gets the fixed marker class `vm-in-view`. No bridge script and no CSP meta are present to remove — both are added at serve time, never stored. `<link rel="stylesheet" href="vibe-motion.css">` is added as the last child of `<head>`.
- `vibe-motion.js`: only emitted if any assignment uses the `in-view` trigger; an `IntersectionObserver` that adds `vm-play` to each element as it is scrolled to, and `vm-js` to `<html>` so the stylesheet's `in-view` rules apply at all. Otherwise omitted and the HTML has no script tag. Its `<script src="vibe-motion.js">` follows the link in `<head>` and is **not deferred** (revised from this plan's original `defer`): `vm-js` has to be set before the first paint, or an in-view element in the first viewport paints at rest, snaps to its first keyframe and then plays. The cost is one small render-blocking request; an inline script would avoid it and break hosts with a strict CSP.

Critical decisions

- **Export executes in the API, not the browser.** The exporter is pure Kotlin over `base_html` + `stateAt(versionId)` + the catalog version pinned on each assignment. Keyframes are emitted once per `(animationId, catalogVersion)` pair in use, named `vm-<id>-v<M>-<m>-<p>`. Export always targets a saved version; if the editor has unsaved changes the Export button prompts to save first. Recommended: API. It keeps export deterministic and testable with golden files, and it means a designer can hit the endpoint directly later.
- **Snippet mode.** In addition to the full page, offer "just the CSS for this element" so a designer can paste into an existing site without replacing their HTML. Recommended: include; it is the same generator scoped to one assignment.

Exit criteria: golden-file tests for three fixture states; Playwright opens the exported HTML in a fresh page and asserts the animation runs.

### Phase 8 — Hardening and launch

- Full e2e suite green locally against the Docker stack (DT-076), plus a post-deploy smoke check of the production URLs.
- Lighthouse on `/help` and the editor shell.
- Rate limit on `POST /projects` (clone is the only expensive endpoint).
- Production deploy via blueprint; secrets provided by Chris in the Render dashboard (`sync: false` vars).
- Smoke test that clones a known page in production.
- Deferred tasks triaged; anything P0/P1 fixed before tagging `v0.1.0`.

---

## 5. Quality gates (every PR)

Defined once in Phase 0, run in CI and locally via `pnpm gates`.

| Gate | Web | API |
|---|---|---|
| Lint | eslint, prettier check | ktlint |
| Types | `tsc --noEmit` | Kotlin compile |
| Unit | vitest | kotest |
| Integration | MSW-backed component tests | Testcontainers Postgres |
| e2e | Playwright: web-only specs against `next dev`; full-stack specs (`apps/e2e/web/stack/`) against a per-run Docker stack of the production web build + the api image + Postgres (`pnpm e2e:docker`) | same stack |
| Build | `next build` | Docker image builds |
| Catalog | JSON Schema validation of every version; `check-immutable` (published files unchanged vs `main`) | Catalog round-trip test for every version |

Any red gate: CI applies the `Gate Flag` label and a bot comment; the PR must not be marked ready. The Test-Runner subagent runs the same gates locally before any merge.

Screenshots for UI PRs are produced by the Screenshot-Runner and committed to the long-lived `pr_screenshot` branch only, then linked from a PR comment. They never land on a working branch or on `main` (see CLAUDE.md).

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Cloned pages render badly without their JS | Designer sees a broken canvas | Fixture set of real pages in Phase 2; deferred "headless render" option |
| Third-party CSS collides with `vm-` runtime | Animation does not visibly run | Prefix everything; `!important` on `animation-name` in the runtime style only, never in export |
| Render starter plan cold starts on API | Slow first clone | Health check keeps it warm; clone timeout messaging in UI |
| Iframe `postMessage` origin mismatch across environments | Bridge silently fails | Allowed origins come from env vars set in `render.yaml`; e2e runs against the local Docker stack with real cross-origin web/api origins; production origins were verified by CORS probe on first deploy (DT-015) |
| Two agents change the OpenAPI contract at once | Integration break in Phase 4 | Additive-only rule after Phase 0; memory.md announces contract edits |
| User loses unsaved draft (tab close, crash) | Frustration, rework | Unsaved indicator + `beforeunload` warning in v0; localStorage draft (DT-016) |
| Diff replay gets slow on a long history | Slow version switching | Checkpoint snapshots (DT-017); trigger is >200 versions on one project |
| Catalog edit changes how a saved animation renders | Designer's saved work silently changes | Immutable catalog versions + per-assignment `catalogVersion` pin + CI immutability gate (Phase 1) |
| Catalog versions accumulate in both bundles | Bundle growth | Each file is a few KB; 50 versions is under 1 MB. Revisit only if it matters. |

---

## 7. Open questions for Chris

1. Should the help page be public (no project needed) or live inside the editor? Plan assumes public at `/help`.
2. Is a 10 MB page size cap acceptable for v0?
3. Do you want the Control Panel width persisted per browser (localStorage) or fixed at 25%?
4. Mock designs from Claude Design: the plan assumes they arrive before Phase 3 starts. Phase 3 can begin with a wireframe-level layout and re-skin when mocks land.

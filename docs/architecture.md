# Vibe Motion — Architecture (v0)

Status: DRAFT for review · Last updated: 2026-09-18

Four views: system context, request flows, data model, and the preview bridge. Decisions referenced here are explained in [build_plan.md](build_plan.md). The designer's journey is in [user_flow.md](user_flow.md).

## 1. System context

```mermaid
flowchart LR
  designer([Designer's browser])

  subgraph render["Render (blueprint: render.yaml)"]
    web["web · Next.js 16<br/>App Router, TypeScript<br/>Node runtime"]
    api["api · Kotlin / Ktor 3<br/>Docker, JDK 21"]
    db[("Postgres 16<br/>projects, versions")]
  end

  catalog[["packages/animation-catalog<br/>versions/*.json (immutable) + current + schema<br/>(all versions built into both apps)"]]
  source["Source web page<br/>(public URL entered by designer)"]

  designer -->|"HTML shell, /help"| web
  designer -->|"iframe src: /projects/{id}/page"| api
  web -->|"typed client from openapi.yaml"| api
  api -->|"Exposed + Flyway"| db
  api -->|"clone: fetch + jsoup rewrite"| source
  catalog -.->|"TS types"| web
  catalog -.->|"kotlinx.serialization"| api
```

Notes

- The browser talks to both services. The shell and control panel come from `web`; the cloned page is served by `api` so the iframe is cross-origin from the shell and all interaction goes through `postMessage` (section 4).
- `web` never touches the database. The API owns the schema via Flyway.
- The catalog is a build-time dependency of both apps and is also served by `GET /catalog` so the two can be checked for agreement at runtime. Every published catalog version is bundled; a saved assignment pins the version it was authored under, and CSS is always derived from that pinned entry rather than stored.

## 2. Monorepo layout

```mermaid
flowchart TB
  root["vibe_motion/"]
  root --> apps["apps/"]
  root --> packages["packages/"]
  root --> docs["docs/  build_plan · architecture · deferred_tasks"]
  root --> claude[".claude/agents/  code-reviewer · test-writer · code-architect · test-runner · screenshot-runner"]
  root --> files["CLAUDE.md · memory.md · render.yaml · .github/workflows/gates.yml"]

  apps --> web["web/  Next.js<br/>app/ (routes) · components/ · lib/bridge · lib/agent · lib/api-client (generated)"]
  apps --> e2e["e2e/  Playwright<br/>web/ · web/mocked/ · web/stack/ · fixtures/ · docker/"]
  apps --> api["api/  Ktor<br/>openapi.yaml · Dockerfile · src/{routes,clone,export,persistence} · db/migration"]
  packages --> cat["animation-catalog/<br/>versions/1.0.0.json … · current · schema.json · CHANGELOG.md<br/>scripts/gen-types · scripts/check-immutable"]
  packages --> bridge["bridge/<br/>src/vm-bridge.js (served by the api jar and the web mock route)<br/>src/protocol.ts (wire types, constants, validation)"]
```

## 3. Request flows

### 3.1 Create project (clone)

```mermaid
sequenceDiagram
  actor D as Designer
  participant W as web (Next.js)
  participant A as api (Ktor)
  participant S as Source page
  participant P as Postgres

  D->>W: enter URL, submit
  W->>A: POST /projects { url }
  A->>A: SSRF check (resolve host, reject private ranges)
  A->>S: GET url (15s timeout, ≤3 redirects, ≤10 MB)
  S-->>A: HTML
  A->>S: GET linked stylesheets
  S-->>A: CSS
  A->>A: jsoup: strip scripts, absolutize URLs, inline CSS,<br/>assign data-vm-id
  A->>P: INSERT project(base_html) + version 0 (state = {})
  A-->>W: 201 { projectId, currentVersionId }
  W-->>D: redirect /p/{projectId}
  D->>W: GET /p/{projectId}
  W-->>D: editor shell (75/25 split)
  D->>A: iframe GET /projects/{id}/page
  A->>A: PageRenderer: base_html + CSP + bridge script tag (serve time)
  A-->>D: rendered page
  D->>A: GET /bridge/vm-bridge.js
```

### 3.2 Select an element, apply and tune an animation

```mermaid
sequenceDiagram
  actor D as Designer
  participant F as iframe (bridge script)
  participant W as Control Panel (web)
  participant M as MockAnimationAgent (web, in-process)
  participant A as api

  D->>F: click element
  F->>W: postMessage element:select { vmId, rect, tag }
  W->>F: postMessage select { vmId }  (highlight ring)
  W->>W: panel state: selected

  alt Generate (one element)
    D->>W: click Auto-generate for this element
    W->>M: suggestForElement(context)
    M-->>W: Assignment { animationId, catalogVersion, trigger, params }
  else Auto-generate (whole page, from idle)
    D->>W: click Auto-generate for this page
    W->>F: postMessage elements:query { filter: tags + min size, limit }
    F-->>W: postMessage elements:list { elements, truncated, viewport }
    W->>M: suggestForPage(candidates, existing, prompt, viewport)
    M-->>W: PageSuggestion { assignments by vmId, skipped }
    W->>W: one store update: draft + generated + lastRun, panel: result list
    W->>F: postMessage state:load (more than 8 changes) or apply × n
  else Custom
    D->>W: click Custom → pick animation from catalog list
  end

  W->>F: postMessage apply { vmId, animationId, params, trigger }
  F->>F: ensure @keyframes in #vm-runtime,<br/>set inline animation-* and --vm-* on element
  W->>W: panel state: tuning

  loop each slider change
    D->>W: adjust param
    W->>W: update draft state in store, mark unsaved
    W->>F: postMessage apply (same vmId, new params)   ← immediate, no network
  end

  D->>W: click Save (label prefilled from diff)
  W->>W: diff = delta(currentVersionState, draftState)
  W->>A: POST /projects/{id}/versions { parentVersionId, diff, label }
  alt parent is current
    A-->>W: 201 version → draft becomes current, unsaved cleared
  else stale parent (saved elsewhere)
    A-->>W: 409 → UI offers rebase draft or discard
  end
```

### 3.3 View and restore a version

```mermaid
sequenceDiagram
  actor D as Designer
  participant W as web
  participant F as iframe
  participant A as api

  D->>W: click version v3 in history list
  opt unsaved changes exist
    W-->>D: save or discard first?
  end
  W->>A: GET /projects/{id}/versions/v3/state
  A->>A: stateAt(v3) = fold diffs v0..v3
  A-->>W: full state
  W->>F: postMessage state:load { state }
  F->>F: clear all inline vm styles, apply each assignment
  W->>W: editor mode: viewing v3 (read-only)
  D->>W: click Restore
  W->>A: POST /projects/{id}/versions/v3/restore
  A->>A: diff = delta(stateAt(current), stateAt(v3))
  A-->>W: 201 v6 (diff returns project to v3's state)
  W->>W: editor mode: editing, current = v6
```

### 3.4 Export

```mermaid
sequenceDiagram
  actor D as Designer
  participant W as web
  participant A as api
  participant P as Postgres

  D->>W: open Export
  opt unsaved changes exist
    W-->>D: save first (export targets a saved version)
  end
  W->>A: GET /projects/{id}/export?versionId=current
  A->>P: SELECT base_html, diffs v0..current
  A->>A: state = stateAt(current)
  A->>A: exporter: catalog + state → css,<br/>base_html → vm-* classes replace data-vm-id,<br/>remove bridge, link css/js
  A-->>W: { html, css, js | null }
  W-->>D: tabs + copy buttons + zip download
```

#### Decisions: what makes an exported page inert

An export is served from the designer's own site, with no CSP of ours behind it (DT-073), and
`base_html` is immutable — a row cloned by last month's rewriter is exported with today's
protections because `HtmlSanitiser` runs again on the way out. Two decisions hold that up.

**jsoup is not an oracle for how a browser parses.** The exporter re-parses `base_html` with jsoup
and serialises it again, and for a while the tests then re-parsed that *output* with jsoup and
called it proof. It is not: jsoup builds the same tree from our output that it built from the
input, so a **parser differential** — markup jsoup serialises one way and a browser reads another —
is invisible from there. One got through: a nested `<form>` that jsoup keeps and a browser ignores,
shifting a `<style>` into MathML where it is not a raw-text element and its contents become live
elements. So: **any claim that exported or cloned HTML is inert is proven in a real browser**, over
the hostile corpus in `apps/api/src/test/resources/export/hostile/`, by
`packages/bridge/e2e/export-hostile.spec.ts`. The Kotlin assertions are the fast half, not the
proof. A document whose export is not a fixed point of `emit` is treated as a failure, because
instability is how that differential announced itself.

**Foreign content in cloned pages is reduced to a safe subset.** Inside an `svg` or `math` subtree,
whether an element's contents are text or markup depends on the exact insertion mode, and
re-implementing that is writing a second parser. So `HtmlSanitiser` removes every raw-text HTML
element (`style`, `xmp`, `noembed`, `noframes`, `plaintext`, `noscript`, `iframe`, `script`) found
anywhere in a foreign subtree, HTML integration points included, and removes `<form>` from foreign
content except under an integration point (`foreignObject`, `desc`, `title`, `mtext`, `mi`, `mo`,
`mn`, `ms`), where ordinary HTML rules resume and the form is disarmed like any other.
`annotation-xml` is deliberately **not** treated as an integration point: it is one only for
certain `encoding` values. Nested forms are unwrapped, which is what a browser does with the inner
start tag.

**One narrow exception, because real pages style their inline icons from inside the `<svg>`.** A
`<style>` directly in SVG — not under an integration point, not under `math` — is kept when all
three of these hold: it has no element children, it has no CDATA child, and its *serialised* bytes
contain no `<`. Together those make it impossible for any parser to read the block as markup: `<`
is the only character that can begin a start tag; a source `&lt;` is decoded to text while parsing
and written back as `&lt;`, so it never becomes one; a literal `<` never reaches the check at all,
because jsoup builds an element out of it and the first condition has already refused; and a CDATA
section is a second syntax whose own delimiters carry `<`. A kept block is still swept like any
other — dangerous `url()` defused, and on the clone path its URLs absolutised. Everything else in
foreign content still goes. Dropping the lot was the first rule here and it was too wide: it kept
the corpus inert and quietly unstyled every inline icon, a fidelity cost far broader than the
threat. Both halves are proved in Chromium over the corpus — the hostile documents stay inert, and
a benign icon's computed `fill` and `stroke` still come from its own block.

## 4. Preview bridge (iframe ⇄ shell)

```mermaid
flowchart LR
  subgraph shell["web origin · editor shell"]
    store["Zustand store<br/>selectedVmId · draftState · currentVersionState · unsaved · mode"]
    panel["Control Panel<br/>idle → selected → choosing → tuning"]
    bridgeClient["bridge client<br/>origin-checked postMessage"]
    store <--> panel
    store <--> bridgeClient
  end

  subgraph frame["api origin · iframe /projects/{id}/page"]
    bridgeScript["packages/bridge vm-bridge.js (script tag added at serve time)<br/>capture-phase click handler · hover outline · runtime style block"]
    dom["Cloned DOM<br/>every element has data-vm-id"]
    runtime["#vm-runtime style<br/>@keyframes for animations in use"]
    bridgeScript --> dom
    bridgeScript --> runtime
  end

  bridgeClient -- "hello · select · apply · clear · replay · preview · preview:clear · state:load" --> bridgeScript
  bridgeScript -- "ready · element:hover · element:select · element:deselect · ack" --> bridgeClient
```

Message envelope: `{ source: "vibe-motion", type, payload, seq? }`. Both sides drop a message unless its `event.origin`, its `event.source` and its envelope shape all pass; the allowed origin is injected from environment (`WEB_ORIGIN` for the API, which the page renderer writes into `data-vm-parent-origin`; the framed page's own origin for the web). `"*"` is never a `targetOrigin` on either side.

Four things the sketch above leaves out, all of them contract
([phase-4-bridge-protocol.md](plans/phase-4-bridge-protocol.md)):

- **Handshake.** `ready` carries `protocolVersion`. The shell sends `hello` when its client mounts *and* on the iframe's `load` event, and the bridge answers every `hello` with a fresh `ready` — the shell is server-rendered, so the frame's first `ready` can be posted before the shell is listening. A `protocolVersion` the shell does not know stops it sending anything and shows a reload banner.
- **`ack`.** Every shell→iframe message carries a `seq` and is answered with `ack { seq, ms, ok }`, where `ms` is the time the bridge spent in the handler. That is what the performance budget is measured against, and what tests await instead of a timer.
- **`preview` is not `apply`.** Hovering a card in the picker shows an animation transiently, on top of whatever is applied and without touching the draft; `preview:clear` restores what was underneath. The shell owns that preview's whole lifetime and must end it — a preview left behind masks every later `apply`.
- **The mock page is cross-origin too.** In mock mode the shell serves itself from one loopback name and frames the other (`localhost` ⇄ `127.0.0.1`, same Next server, same port), with the API's own CSP and the same `packages/bridge` script. A same-origin mock would let a bridge that skipped its origin check pass e2e.

## 5. Data model

```mermaid
erDiagram
  PROJECTS ||--o{ VERSIONS : has
  PROJECTS {
    uuid id PK
    text source_url
    text title
    text base_html "immutable after clone; contains data-vm-id"
    uuid current_version_id FK
    timestamptz created_at
  }
  VERSIONS {
    uuid id PK
    uuid project_id FK
    uuid parent_version_id "null for v0"
    int seq "1..n within project"
    text label "user-editable at save time"
    text catalog_version "catalog the editor authored against at save"
    jsonb diff "delta from parent: {set, remove}; each set entry pins catalogVersion"
    timestamptz created_at
  }
```

Versions are created only when the user clicks Save. Each stores a diff against its parent; full state is never stored. `stateAt(N)` folds the diffs from v0 (empty) through N.

**CSS is derived, not stored.** An assignment is a reference `(animationId, catalogVersion)` plus `params`. Catalog files are immutable once published, so that reference always resolves to the same keyframes template, and the same generator (browser runtime and Kotlin exporter) produces the same CSS from it. Nothing in Postgres holds CSS text.

`diff` example (one version):

```json
{
  "set": {
    "vm-17": { "animationId": "fade-in-up", "catalogVersion": "1.0.0", "trigger": "load",
               "params": { "duration": "600ms", "delay": "0ms", "easing": "ease-out", "iteration": "1", "distance": "24px" } }
  },
  "remove": ["vm-42"]
}
```

Materialised `state` (what the iframe and exporter consume):

```json
{
  "vm-17": { "animationId": "fade-in-up", "catalogVersion": "1.0.0", "trigger": "load",
             "params": { "duration": "600ms", "delay": "0ms", "easing": "ease-out", "iteration": "1", "distance": "24px" } }
}
```

Resolution to CSS:

```mermaid
flowchart LR
  a["assignment<br/>fade-in-up · 1.0.0 · params"] --> lookup["CATALOGS['1.0.0'].entries['fade-in-up']<br/>(immutable keyframes template + param defs)"]
  lookup --> gen["generator (same code in web runtime and api exporter)"]
  a --> gen
  gen --> kf["@keyframes vm-fade-in-up-v1-0-0 { … }"]
  gen --> rule[".vm-a1 { animation: vm-fade-in-up-v1-0-0 600ms ease-out 0ms 1; --vm-distance: 24px }"]
```

Catalog lifecycle:

```mermaid
flowchart LR
  edit["Need to change an animation"] --> newfile["Add versions/1.1.0.json<br/>(copy of 1.0.0 + change)"]
  newfile --> bump["Update current → 1.1.0<br/>+ CHANGELOG entry"]
  bump --> ci{"CI check-immutable:<br/>any existing versions/*.json changed?"}
  ci -->|"yes"| fail["Gate fails · Gate Flag"]
  ci -->|"no"| merge["Merge"]
  merge --> editor["Editor, help page, mock agent<br/>author against 1.1.0"]
  merge --> old["Saved assignments pinned to 1.0.0<br/>still resolve against 1.0.0 unchanged"]
```

```mermaid
flowchart LR
  v0["v0<br/>diff: {}"] --> v1["v1<br/>set vm-17"] --> v2["v2<br/>set vm-42"] --> v3["v3<br/>set vm-17 (new params)<br/>remove vm-42"]
  v3 -. "stateAt(v3) = fold(v0..v3)" .-> s3["state: { vm-17: fade-in-up (new params) }"]
  v3 --> v4["v4 · Restore v1<br/>diff = delta(stateAt(v3), stateAt(v1))"]
```

## 6. Deployment (render.yaml)

```mermaid
flowchart TB
  gh["GitHub repo<br/>main + PR branches"]
  subgraph prod["Render project: vibe-motion · environment: production"]
    web["web · type web · runtime node<br/>pnpm workspace build · healthCheck /api/health"]
    api["api · type web · runtime docker<br/>dockerfilePath apps/api/Dockerfile · healthCheck /health"]
    db[("vibe-motion-db · Postgres 16")]
    web -->|"NEXT_PUBLIC_API_ORIGIN = fromService api host"| api
    api -->|"DATABASE_URL = fromDatabase connectionString"| db
  end
  gh -->|"autoDeployTrigger: checksPass"| prod
```

PR preview environments are off (`previews.generation: off`); e2e runs locally against Docker. Secrets (`sync: false`) are entered by Chris in the Render dashboard. Everything else is derived by the blueprint.

## 7. Extension points already reserved

| Future capability | Where it plugs in |
|---|---|
| Real LLM agent | Implements `AnimationAgent`; moves from web to an API endpoint. UI unchanged. |
| Figma / PNG ingestion | New "source adapter" in the clone service producing `base_html`. Everything downstream unchanged. |
| JS / scroll animations | New `trigger` values and an `engine` field on catalog entries (a new major catalog version); exporter grows a JS emitter. |
| Upgrade saved assignments to a newer catalog version | Explicit user action producing a new version whose diff rewrites `catalogVersion` (DT-019). |
| Auth and teams | `owner_id` on `projects`; middleware in both apps. |

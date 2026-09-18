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
  apps --> api["api/  Ktor<br/>openapi.yaml · Dockerfile · src/{routes,clone,export,persistence} · db/migration"]
  packages --> cat["animation-catalog/<br/>versions/1.0.0.json … · current · schema.json · CHANGELOG.md<br/>scripts/gen-types · scripts/check-immutable"]
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

  alt Generate
    D->>W: click Generate
    W->>M: suggestForElement(context)
    M-->>W: { animationId, params, trigger }
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
    bridgeScript["vm-bridge.js (script tag added at serve time)<br/>capture-phase click handler · hover outline · runtime style block"]
    dom["Cloned DOM<br/>every element has data-vm-id"]
    runtime["#vm-runtime style<br/>@keyframes for animations in use"]
    bridgeScript --> dom
    bridgeScript --> runtime
  end

  bridgeClient -- "select · apply · clear · replay · state:load" --> bridgeScript
  bridgeScript -- "ready · element:hover · element:select" --> bridgeClient
```

Message envelope: `{ source: "vibe-motion", type, payload }`. Both sides drop messages whose `event.origin` is not in the allow-list injected from environment (`WEB_ORIGIN` for the API, `NEXT_PUBLIC_API_ORIGIN` for the web).

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

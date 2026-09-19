# apps/web — Vibe Motion editor shell

Next.js 16 (App Router, TypeScript strict, Tailwind v4, shadcn/ui) editor shell for Vibe Motion.
Phase 0 scope: routing, the split layout, the help page and the generated API client. Everything
else is a wireframe placeholder — see [docs/build_plan.md](../../docs/build_plan.md) Phase 3+.

## Run

All commands work from the repo root (`pnpm --filter web <script>`) or from this directory.

```bash
pnpm install              # from the repo root: installs the whole JS workspace
pnpm --filter web dev     # http://localhost:3000, expects the API on :8080
pnpm --filter web build   # production build
pnpm --filter web start   # serve the build on $PORT (default 3000) — this is what Render runs
```

Environment: `NEXT_PUBLIC_API_ORIGIN` (default `http://localhost:8080`). Copy the repo-root
`.env.example` to `.env.local`. It is read in exactly one place, `lib/env.ts`; never touch
`process.env` anywhere else.

## Test

```bash
pnpm --filter web lint        # eslint (flat config, eslint-config-next)
pnpm --filter web typecheck   # next typegen && tsc --noEmit
pnpm --filter web test        # vitest + @testing-library/react (jsdom), unit tests next to source
pnpm e2e                      # playwright, from apps/e2e; starts its own `next dev` on a free port (never reuses one; see apps/e2e/README.md)
```

e2e lives in `apps/e2e` (see its README). First run on a new machine: `pnpm --filter e2e exec playwright install chromium`.
`pnpm gates` at the repo root runs lint, typecheck, unit and build for this package (plus api and catalog).

## gen:client

`lib/api-client/schema.d.ts` is generated from the frozen contract at `apps/api/openapi.yaml`:

```bash
pnpm --filter web gen:client   # or `pnpm gen:client` at the repo root
```

The file is committed and **never hand-edited**. Regenerate it whenever `openapi.yaml` changes, and
import the typed client from `@/lib/api-client` (`apiClient`, plus `Project`, `Version`,
`Assignment`, `Catalog`… type aliases). Server data goes through TanStack Query; the provider lives
in `app/providers.tsx`.

## Layout

```
app/                     routes: / (URL entry), /p/[projectId] (editor), /help (catalog), /api/health (Render health check)
components/ui/           shadcn/ui primitives (do not edit by hand; re-add with the shadcn CLI)
components/control-panel.tsx  Control Panel placeholder (client)
lib/env.ts               the only reader of process.env
lib/catalog.ts           build-time read of packages/animation-catalog/versions/1.0.0.json
lib/api-client/          generated types + typed openapi-fetch client
lib/store/               Zustand editor store (placeholder, shape from docs/architecture.md §4)
mocks/                   MSW handlers + in-memory store, mounted only when NEXT_PUBLIC_API_MOCKING=enabled
```

Playwright specs for this app live in [`apps/e2e/web/`](../e2e/README.md), never here.

Conventions (see [CLAUDE.md](../../CLAUDE.md)): Server Components by default, `"use client"` only
where interactivity demands it, Tailwind + shadcn/ui, no CSS modules, and everything injected into a
cloned page or an export is prefixed `vm-` / `--vm-` / `data-vm-`.

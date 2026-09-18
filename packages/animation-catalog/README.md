# animation-catalog

The single source of truth for every CSS animation Vibe Motion can apply. Consumed by `apps/web` (TypeScript, via `src/index.ts`) and `apps/api` (Kotlin, copies `versions/*.json` and `current` into its jar at build time).

## Immutability rule

Files under `versions/` are **never edited once merged to `main`**, not even for a typo. Every change is:

1. a new `versions/<semver>.json` (start from a copy of the latest),
2. a bump of `current` if the editor should author against it,
3. an entry in `CHANGELOG.md`.

Semver: patch = metadata only (name, description, category, labels); minor = new animations or new optional params; major = changed keyframes, removed animations, renamed or removed params.

`pnpm check-immutable` enforces this in CI by comparing every published file against `origin/main`. Saved projects pin the catalog version per assignment, so an old version must keep rendering exactly as it did.

## Scripts

| Script | What |
|---|---|
| `pnpm validate` | JSON Schema + semantic checks on every version file and `current` |
| `pnpm check-immutable` | Published files unchanged vs base branch |
| `pnpm gen-types` | Regenerates `src/schema.ts` and `src/index.ts` and builds `dist/` |
| `pnpm test` | Keyframes parse, defaults within range, gate behaviour |

## Entry shape

See `schema.json`. In short: `id`, `name`, `category`, `description`, `keyframes` (body only; the generator wraps it as `@keyframes vm-<id>-v<major>`), `params` (standard keys `duration`, `delay`, `easing`, `iteration`, `direction` map to `animation-*`; any other key declares a `cssVar` referenced inside the keyframes), `triggers`, optional `defaultTrigger` and `baseStyles`.

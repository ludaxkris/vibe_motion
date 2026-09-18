# animation-catalog

The single source of truth for every CSS animation Vibe Motion can apply. Consumed by `apps/web` (TypeScript, via `src/index.ts`) and `apps/api` (Kotlin, copies `versions/*.json` and `current` into its jar at build time).

## Immutability rule

Files under `versions/` are **never edited once merged to `main`**, not even for a typo. Every change is:

1. a new `versions/<semver>.json` (start from a copy of the latest),
2. a bump of `current` if the editor should author against it,
3. an entry in `CHANGELOG.md`.

Semver: **patch** = metadata only (name, description, category, labels); **minor** = new animations, or new params (standard or cssVar-backed) whose default reproduces the previous rendering — this may add `var(--vm-x)` references to keyframes/baseStyles; **major** = changed rendering at default params, removed animations, renamed or removed params.

`pnpm check-immutable` enforces this in CI by comparing every published file against `origin/main`. Saved projects pin the catalog version per assignment, so an old version must keep rendering exactly as it did.

`pnpm validate` additionally runs a **superset gate**: for any two published versions sharing a MAJOR, the earlier one's set of animation ids, and each shared id's set of param keys, must be a subset of the later one's. A minor or patch release may add an id or a param key within a major; it may never drop one — that would be a breaking change disguised as non-major. (Removing an id or a key is only legal across a major bump.) The `select`-type rule is separate and unconditional regardless of major: a `select` param must declare a non-empty `options` array and its `default` must be one of those options.

## Scripts

| Script | What |
|---|---|
| `pnpm validate` | JSON Schema + semantic checks on every version file and `current` |
| `pnpm check-immutable` | Published files unchanged vs base branch |
| `pnpm gen-types` | Regenerates `src/schema.ts` and `src/index.ts` and builds `dist/` |
| `pnpm test` | Keyframes parse, defaults within range, gate behaviour |

## Entry shape

See `schema.json`. In short: `id`, `name`, `category`, `description`, `keyframes` (body only; the generator wraps it as `@keyframes vm-<id>-v<major>-<minor>-<patch>`, e.g. `vm-fade-in-up-v1-1-0` — the full catalog version, not just the major, via `keyframesName(animationId, version)`), `params` (standard keys `duration`, `delay`, `easing`, `iteration`, `direction`, `fillMode` map to `animation-*`; any other key declares a `cssVar` referenced inside the keyframes), `triggers`, optional `defaultTrigger` and `baseStyles`.

`fillMode` (from catalog 1.1.0 onward) is a `select` param with `options: ["none", "forwards", "backwards", "both"]` and maps to `animation-fill-mode`; every entry from 1.1.0 onward must declare it (`pnpm validate` enforces this; 1.0.0 entries are exempt since the key did not exist yet).

# apps/api — Vibe Motion API

Kotlin / Ktor 3 service. Owns the Postgres schema (Flyway), serves the animation catalog, and
(from Phase 2 on) the clone / versions / export endpoints. The contract lives in
[`openapi.yaml`](openapi.yaml) and every endpoint exists there before it exists in code.

## Phase 0 surface

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, db, version }`. `503` with `db: "down"` when `select 1` fails. |
| GET | `/catalog` | The `current` catalog version, served verbatim. |
| GET | `/catalog/versions` | `{ current, versions }`, versions ascending by semver. |
| GET | `/catalog/{version}` | One published version. `404` with an `Error` body if unknown. |

Anything else returns `404` with `{ "code", "message" }`; malformed JSON returns `400` with the
same shape.

## Run it locally

Postgres first, from the repo root:

```bash
docker compose up -d db
```

Then, from `apps/api`:

```bash
DATABASE_URL=postgresql://vibe_motion:vibe_motion@localhost:5433/vibe_motion ./gradlew run
curl localhost:8080/health
```

Flyway migrates on startup, so the first run creates `projects` and `versions`.

> The compose file publishes Postgres on host port **5433** (not 5432) because a Homebrew
> Postgres on `localhost:5432` would otherwise win over the container's bind. `.env.example`
> at the repo root already uses 5433.

## Test it

```bash
./gradlew check        # ktlint + Kotest; needs a running Docker daemon
./gradlew test
./gradlew ktlintFormat # fix formatting
```

`check` runs ktlint over main and test sources plus the full Kotest suite. `ApiIntegrationTest`
starts a `postgres:16-alpine` Testcontainer, so Docker must be running; the rest of the suite is
in-process and needs nothing.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | *(required)* | `postgresql://user:pass@host:port/db` (Render's format) or a `jdbc:` URL, which is passed through untouched. |
| `PORT` | `8080` | HTTP port. |
| `WEB_ORIGIN` | `http://localhost:3000` | The single origin allowed by CORS (scheme + host + port). |
| `CLONE_MAX_BYTES` | `10485760` | Size cap for a cloned page (used from Phase 2). |
| `CLONE_TIMEOUT_MS` | `15000` | Fetch timeout when cloning (used from Phase 2). |
| `APP_VERSION` | `RENDER_GIT_COMMIT`, else `dev` | Reported by `/health`. |

Values for local development are in the repo root `.env.example`. Never commit real secrets.

## The animation catalog

`packages/animation-catalog` is the single source of truth. The `catalogResources` Gradle task
copies `versions/*.json` and `current` into the jar under `catalog/`, and writes a `versions.txt`
index (a directory inside a jar cannot be listed). `ClasspathCatalogRepository` loads every
version at startup into the data classes in `catalog/CatalogModels.kt`, with
`ignoreUnknownKeys = false` so any drift from `schema.json` fails the build rather than being
silently dropped. Responses are the original bytes, not a re-serialisation.

## Layout

```
src/main/kotlin/dev/vibemotion/api/
  Application.kt              main() + the Ktor module (plugins, CORS, StatusPages, routing)
  config/AppConfig.kt         environment parsing, DATABASE_URL -> JDBC conversion
  catalog/CatalogModels.kt    Kotlin mirror of packages/animation-catalog/schema.json
  catalog/CatalogRepository.kt  CatalogRepository interface + classpath implementation
  persistence/Database.kt     Hikari pool, Flyway migrate, Exposed connect, health probe
  persistence/Tables.kt       Exposed mirrors of the migration
  routes/HealthRoutes.kt      GET /health
  routes/CatalogRoutes.kt     GET /catalog, /catalog/versions, /catalog/{version}
  model/ApiError.kt           the Error schema from openapi.yaml
src/main/resources/db/migration/V1__baseline.sql
```

## Docker

The image is built with the **repo root** as context, because it bundles the catalog:

```bash
docker build -f apps/api/Dockerfile -t vibe-motion-api:dev .    # from the repo root
docker run --rm -p 8080:8080 -e DATABASE_URL=... vibe-motion-api:dev
```

Stage 1 builds with the Gradle wrapper on `eclipse-temurin:21-jdk`; stage 2 runs the
`installDist` output on `eclipse-temurin:21-jre` as the non-root `vibe` user. Tests are not run
in the image build (Testcontainers needs a Docker daemon); CI runs them.

`Dockerfile.dockerignore` keeps `node_modules`, `apps/web` and build output out of the context —
BuildKit reads it in preference to a context-root `.dockerignore`. `.dockerignore` covers the
case where someone builds with `apps/api` as the context instead.

## Conventions

Kotlin idiomatic, no `!!`. Routes stay thin; logic goes in services and persistence sits behind
repository interfaces. kotlinx.serialization for JSON. ktlint (`ktlint_official`) is wired into
`check`, configured by `.editorconfig`.

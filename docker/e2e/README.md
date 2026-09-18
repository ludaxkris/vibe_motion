# Docker e2e stack

`pnpm e2e:docker` (= `scripts/e2e-docker.sh`) runs the Playwright suite against the whole product:

| Service | What it is |
|---|---|
| `db` | `postgres:16-alpine` on tmpfs. Empty at start, gone at the end. |
| `api` | `apps/api/Dockerfile`, the exact image Render builds, 512 MB like the starter plan. Flyway migrates the empty database on boot. |
| `web` | `docker/e2e/web.Dockerfile`: render.yaml's `buildCommand` / `startCommand`, i.e. `next build` + `next start`, not `next dev`. |
| `fixtures` | nginx serving `apps/web/e2e/fixtures/` as `http://fixtures.vm-e2e.test`. The pages e2e clones. |
| `runner` | The Playwright image matching the lockfile's `@playwright/test`, running `apps/web/playwright.docker.config.ts`. |

## One stack per run, any number at once

Every invocation creates a **new compose project** `vm-e2e-<worktree>-<run id>` with its own network
and database, and destroys it on exit (pass or fail, Ctrl-C included). Nothing publishes a host port
and nothing sets a `container_name`; the runner is inside the network and uses service names. So two
agents in two worktrees, or two runs in one worktree, cannot see or break each other, and there is
no port to pick.

Images are tagged **per worktree** (`vm-e2e-{api,web,runner}:<worktree>-<path hash>`): your branch's
build never replaces the image another branch is testing, and a re-run reuses its layers. Layer cache
is shared machine-wide, so a second worktree's first build is mostly cache hits.

```bash
pnpm e2e:docker                    # build, run, destroy
scripts/e2e-docker.sh --keep       # leave the stack up and print how to get logs / a shell
scripts/e2e-docker.sh prune        # remove this worktree's stacks and images
scripts/e2e-docker.sh prune-all    # remove every vm-e2e stack and image on the machine
```

`scripts/cleanup-merged.sh` runs `prune` for a worktree before deleting it. Reports and traces land
in `apps/web/playwright-report-docker/` (gitignored).

## Writing specs

- Web-only specs stay in `apps/web/e2e/*.spec.ts`; they run both here and under `pnpm --filter web e2e`.
- Anything needing the api goes in `apps/web/e2e/stack/` (ignored by the default config). Import
  origins from `stack/env.ts`; never hardcode them.
- Clone fixture pages (`${stack.fixtureOrigin}/marketing.html`), never the public internet. Add pages
  under `apps/web/e2e/fixtures/`.
- The origins are real and distinct (`http://web:3000`, `http://api:8080`), so CORS and the bridge's
  `postMessage` origin checks are exercised exactly as in production.

## Why the network is on 11.x

The api under test must be the production image with `SsrfGuard` intact, and Phase 2 decided that no
env var or config may relax the guard in a deployable build. A normal Docker network hands out
172.x / 10.x / 192.168.x addresses, which the guard (correctly) refuses, so the fixture server would
be unclonable. Instead the stack's network takes a random /24 from `11.0.0.0/8`: a block that is
assigned but not routed on the public internet, and in none of the guard's refused ranges. The guard
runs unmodified and sees an ordinary-looking address.

Consequences, all confined to the stack's private network:

- Inside a stack, the guard does not protect `db` / `web` from the cloner. That is a property of this
  test network, not of the product; `stack/clone.spec.ts` separately asserts that private, loopback,
  link-local and `localhost` targets are still refused.
- Containers in a running stack cannot reach real hosts in their own 11.x.y.0/24. Nothing needs to.
- Two concurrent stacks drawing the same /24 (1 in 65,536) are refused by Docker; the script redraws.

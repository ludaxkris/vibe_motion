# apps/e2e — end-to-end tests

End-to-end tests for every Vibe Motion client live here, not inside the app they exercise, so a
second client does not have to borrow another app's folder.

```
apps/e2e/
  web/                     Playwright specs for the web app
    *.spec.ts              true of any deployment: run against `next dev` (`pnpm e2e`) AND in the Docker stack
    mocked/                need the MSW mock api or a dev build: run only under `pnpm e2e`
    stack/                 need the real api + Postgres: run only inside the Docker stack
  mobile/                  (future) specs for a mobile client; add a Playwright project or its own runner here
  fixtures/                static pages the stack serves for cloning; shared by every client's specs
  docker/                  the full-stack compose file, web + runner images, health waiter
  playwright.config.ts           local, web-only
  playwright.docker.config.ts    inside the stack
```

```bash
pnpm e2e           # web/ + web/mocked/; starts its OWN `next dev` (MSW mocks on) on a free port and
                   # never attaches to a server that is already running (DT-113); extra args go to Playwright
VM_E2E_PORT=3210 pnpm e2e                  # pin the port
VM_E2E_REUSE=1 VM_E2E_PORT=3000 pnpm e2e   # attach to the `pnpm dev` you started in THIS worktree
pnpm e2e:docker    # web/ + web/stack/, against a brand-new full stack in Docker
```

First local run on a new machine: `pnpm --filter e2e exec playwright install chromium`.

# Docker e2e stack

`pnpm e2e:docker` (= `scripts/e2e-docker.sh`) runs the Playwright suite against the whole product:

| Service | What it is |
|---|---|
| `db` | `postgres:16-alpine` on tmpfs. Empty at start, gone at the end. |
| `api` | `apps/api/Dockerfile`, the exact image Render builds, 512 MB like the starter plan. Flyway migrates the empty database on boot. |
| `web` | `docker/web.Dockerfile`: render.yaml's `buildCommand` / `startCommand`, i.e. `next build` + `next start`, not `next dev`. |
| `fixtures` | nginx serving `apps/e2e/fixtures/` as `http://fixtures.vm-e2e.test`. The pages e2e clones. |
| `runner` | The Playwright image matching the lockfile's `@playwright/test`, running `playwright.docker.config.ts`. |

## One stack per run, any number at once

Every invocation creates a **new compose project** `vm-e2e-<worktree>-<epoch>-<rand>` with its own
network, database and report directory, and destroys the stack on exit (pass, fail, Ctrl-C, SIGTERM
and SIGHUP included). Nothing publishes a host port and nothing sets a `container_name`; the runner
is inside the network and uses service names. So two agents in two worktrees, or two runs in one
worktree, cannot see or break each other, and there is no port to pick.

A run that is SIGKILLed (an agent harness hitting its tool timeout, for instance) cannot clean up.
The next run in that worktree reaps any of its own stacks older than 30 minutes, and `prune` removes
them at once. **Agents: run `pnpm e2e:docker` and `pnpm gates` in the background**; a cold build can
outlast a foreground tool timeout.

The network is `internal`: no container has a route out. The suite is hermetic, and a fixture that
references the public internet fails loudly instead of quietly depending on it.

Images are tagged **per worktree** (`vm-e2e-{api,web,runner}:<worktree>-<path hash>`): your branch's
build never replaces the image another branch is testing, and a re-run reuses its layers. Layer cache
is shared machine-wide, so a second worktree's first build is mostly cache hits. Tags are per
worktree, not per run: if the tree changes between one run's build and a second concurrent run's
build in the same worktree, both test the newer images. One agent per worktree makes that moot.

```bash
pnpm e2e:docker                    # build, run, destroy
scripts/e2e-docker.sh --keep       # leave the stack up and print how to get logs / a shell
scripts/e2e-docker.sh prune        # remove this worktree's stacks and images
scripts/e2e-docker.sh prune-all --yes   # every vm-e2e stack and image on the machine, other agents' running ones included
```

`scripts/cleanup-merged.sh` runs `prune` for a worktree before deleting it. Reports and traces land
in `apps/e2e/playwright-report-docker/<run>/` (gitignored; `latest` is a symlink to the newest, the
five newest are kept).

## Writing specs

Three buckets, by what a spec needs of the deployment under it:

- `web/*.spec.ts` — needs no api and no dev build, so it runs **both** here and under `pnpm e2e`.
  That is the default; put a spec here unless it cannot live here.
- `web/mocked/` — needs the MSW mock api (`apps/web/mocks/`) or a development build. Only
  `pnpm e2e` runs these: this stack is `next build` + `next start` against the real api, where
  `lib/env.ts` forces `apiMocking` off and `/dev` 404s. Ignored by `playwright.docker.config.ts`.
- `web/stack/` — needs the real api + Postgres. Only `pnpm e2e:docker` runs these; ignored by
  `playwright.config.ts`. Import origins from `stack/env.ts`; never hardcode them.

A flow worth having both ways gets a spec in each of the last two (`web/mocked/editor.spec.ts`
and `web/stack/editor.spec.ts` are the clone → editor flow, faked and real).
- Clone fixture pages (`${stack.fixtureOrigin}/marketing.html`), never the public internet. Add pages
  under `fixtures/`.
- The database is never cleaned within a run and specs run in parallel with retries: scope every
  assertion to the project the test created; never assert on global counts or list order.
- The api admits 2 concurrent clones and answers 503 + `Retry-After` after a 5 s queue. `workers` is
  pinned to 4 in the config for that reason; if a spec clones a lot, go through a helper that honours
  the 503, which is also what the UI must do.
- The origins are real and distinct (`http://web:3000`, `http://api:8080`), so CORS and the bridge's
  `postMessage` origin checks are exercised exactly as in production.

## Why the network is on 11.x

The api under test must be the production image with `SsrfGuard` intact, and Phase 2 decided that no
env var or config may relax the guard in a deployable build. A normal Docker network hands out
172.x / 10.x / 192.168.x addresses, which the guard (correctly) refuses, so the fixture server would
be unclonable.

The guard is a deny-list over everything that is not public unicast, so any in-stack address it
accepts is by construction somebody's public address space; there is no cleaner range to find.
(Reserved ranges the guard happens not to refuse are guard bugs to be fixed, not test
infrastructure to build on.) So the stack's network takes a random /24 from `11.0.0.0/8`: public
unicast space that nothing in the stack needs to reach, shadowed only inside the stack's own
`internal` network. The guard runs unmodified and sees an ordinary-looking address.

Consequences, all confined to the stack's private network:

- Inside a stack, the guard does not protect `db` / `web` from the cloner. That is a property of this
  test network, not of the product; `stack/clone.spec.ts` separately asserts that private, loopback,
  link-local and `localhost` targets are still refused.
- On a Linux host (CI included) the bridge adds a route for that /24 while the stack is up, so the
  host cannot reach the real 11.x.y.0/24 for those seconds. On Docker Desktop the route lives in the
  VM and the host is untouched. A VPN that squats on 11/8 is out-ranked by the more specific /24.
- IPv6 is pinned off for the network: a daemon-wide IPv6 default would hand fixtures a unique-local
  AAAA, and the guard vets every resolved address.
- The fixture alias must not end in a suffix the guard treats as local (`.localhost`, `.internal`,
  `.local`); `.test` is reserved by RFC 6761 and is not one of them.
- Two concurrent stacks drawing the same /24 (1 in 65,536) are refused by Docker; the script redraws.

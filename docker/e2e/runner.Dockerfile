# Vibe Motion e2e runner — Playwright inside the stack's network. Build context is the REPO ROOT.
#
# PLAYWRIGHT_VERSION must equal the @playwright/test version in pnpm-lock.yaml (the browsers in the
# base image are tied to it). scripts/e2e-docker.sh reads it from the lockfile; never hardcode it.

ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

# The image's Node may be newer than the repo's `engines` pin; only the test runner runs here.
# HOME is writable for whatever uid the stack runs the container as (see compose.yml `user:`).
ENV CI=1 HOME=/tmp
WORKDIR /repo
RUN corepack enable

# `pnpm fetch` needs only the lockfile, so this layer survives everything except a dependency
# change, and no workspace member is listed by hand: a new packages/<x> just works.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
RUN pnpm fetch --config.engine-strict=false

COPY packages packages
COPY apps/web apps/web
RUN pnpm install --offline --frozen-lockfile --config.engine-strict=false
COPY docker/e2e/wait-for-stack.mjs docker/e2e/wait-for-stack.mjs

WORKDIR /repo/apps/web
CMD ["sh", "-c", "node /repo/docker/e2e/wait-for-stack.mjs && pnpm exec playwright test --config playwright.docker.config.ts"]

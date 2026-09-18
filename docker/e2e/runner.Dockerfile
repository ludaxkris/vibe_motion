# Vibe Motion e2e runner — Playwright inside the stack's network. Build context is the REPO ROOT.
#
# PLAYWRIGHT_VERSION must equal the @playwright/test version in pnpm-lock.yaml (the browsers in the
# base image are tied to it). scripts/e2e-docker.sh reads it from the lockfile; never hardcode it.

ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ENV CI=1
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/animation-catalog/package.json packages/animation-catalog/package.json
# The image's Node may be newer than the repo's `engines` pin; only the test runner runs here.
RUN pnpm install --frozen-lockfile --config.engine-strict=false

COPY packages/animation-catalog packages/animation-catalog
COPY apps/web apps/web
COPY docker/e2e/wait-for-stack.mjs docker/e2e/wait-for-stack.mjs

WORKDIR /repo/apps/web
CMD ["sh", "-c", "node /repo/docker/e2e/wait-for-stack.mjs && pnpm exec playwright test --config playwright.docker.config.ts"]

# Vibe Motion web — e2e image. Build context is the REPO ROOT.
#
# Render runs the web service on its native Node runtime, not from an image, so this file mirrors
# render.yaml's buildCommand / startCommand line for line. If you change one, change the other.
#
#   docker build -f docker/e2e/web.Dockerfile -t vm-e2e-web:dev .

FROM node:22-slim

ENV NEXT_TELEMETRY_DISABLED=1 CI=1
WORKDIR /repo
RUN corepack enable

# `pnpm fetch` needs only the lockfile, so this layer survives everything except a dependency
# change, and no workspace member is listed by hand: a new packages/<x> just works.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
RUN pnpm fetch

COPY packages packages
COPY apps/web apps/web
RUN pnpm install --offline --frozen-lockfile

# Inlined into the bundle by `next build`, exactly as on Render.
ARG NEXT_PUBLIC_API_ORIGIN
ENV NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN}
RUN pnpm --filter web build

ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]

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

# Manifests first so `pnpm install` stays in the layer cache until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/animation-catalog/package.json packages/animation-catalog/package.json
RUN pnpm install --frozen-lockfile

COPY packages/animation-catalog packages/animation-catalog
COPY apps/web apps/web

# Inlined into the bundle by `next build`, exactly as on Render.
ARG NEXT_PUBLIC_API_ORIGIN
ENV NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN}
RUN pnpm --filter web build

ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]

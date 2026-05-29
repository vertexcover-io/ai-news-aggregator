# syntax=docker/dockerfile:1.7

# Build stage — uses the shared base image.
FROM node:22-alpine AS build

# Browser binaries belong in the runtime stage (which uses the official
# Playwright image with browsers preinstalled). Alpine can't run them anyway.
# The add-post web crawler launches Chromium inside the API process, so the
# API runtime needs the browsers just like the pipeline does.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json        packages/shared/package.json
COPY packages/api/package.json           packages/api/package.json
COPY packages/pipeline/package.json      packages/pipeline/package.json
COPY packages/web/package.json           packages/web/package.json
COPY packages/eslint-plugin/package.json packages/eslint-plugin/package.json

# pnpm-workspace.yaml declares patchedDependencies; the patch files must be
# present before install or `pnpm install` fails with ENOENT on the patch path.
COPY patches ./patches

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/pipeline ./packages/pipeline
COPY packages/api ./packages/api

RUN pnpm --filter @newsletter/shared build \
 && pnpm --filter @newsletter/pipeline build \
 && pnpm --filter @newsletter/api build

# Keep only production deps for the runtime image.
# --legacy is required on pnpm 10+ for workspaces without inject-workspace-packages.
RUN pnpm --filter @newsletter/api --prod --legacy deploy /out/api

# Runtime stage — Microsoft's official Playwright image. The add-post flow
# runs fetchWebPost -> fetchBrowser -> chromium.launch() inside the API
# process, so the API needs the preinstalled browsers. Pinned to match the
# `playwright` npm package version (packages/pipeline/package.json) — bumping
# Playwright requires bumping this tag in lockstep (same as pipeline.Dockerfile).
FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS runtime

ENV NODE_ENV=production \
    PORT=3000
# The official image installs browsers under /ms-playwright. Make sure the
# Playwright package looks there at runtime instead of $HOME/.cache.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN groupadd -r app && useradd -r -g app -m -d /home/app app

WORKDIR /app

# App code + prod node_modules, produced by `pnpm deploy`.
COPY --from=build --chown=app:app /out/api /app

# Drizzle migration runner + SQL files. deploy.sh runs:
#   docker compose exec api node /app/migrate.mjs
COPY --from=build --chown=app:app /app/packages/shared/src/db/migrations /app/migrations
COPY --chown=app:app deployment/migrate.mjs /app/migrate.mjs

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]

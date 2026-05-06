# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

# Browser binaries belong in the runtime stage (which uses the official
# Playwright image with browsers preinstalled). Alpine can't run them anyway.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json        packages/shared/package.json
COPY packages/api/package.json           packages/api/package.json
COPY packages/pipeline/package.json      packages/pipeline/package.json
COPY packages/web/package.json           packages/web/package.json
COPY packages/eslint-plugin/package.json packages/eslint-plugin/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/pipeline ./packages/pipeline

RUN pnpm --filter @newsletter/shared build \
 && pnpm --filter @newsletter/pipeline build

RUN pnpm --filter @newsletter/pipeline --prod --legacy deploy /out/pipeline

# Runtime: Microsoft's official Playwright image. Pinned to match the
# `playwright` npm package version (packages/pipeline/package.json). Bumping
# Playwright requires bumping this tag in lockstep.
FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS runtime

ENV NODE_ENV=production
# The official image installs browsers under /ms-playwright. Make sure the
# Playwright package looks there at runtime instead of $HOME/.cache.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN groupadd -r app && useradd -r -g app -m -d /home/app app

WORKDIR /app

COPY --from=build --chown=app:app /out/pipeline /app

USER app

# Pipeline has no HTTP port; healthcheck runs the node process and
# docker reports it unhealthy if the main process exits.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f "node dist/index.js" > /dev/null || exit 1

CMD ["node", "dist/index.js"]

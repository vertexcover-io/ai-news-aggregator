# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

# Build stage does not run browsers; skip Playwright's bundled download.
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

# Runtime: Debian slim + system Chromium via apt. We use playwright-core
# (no bundled browser download) and point it at the apt-installed binary
# via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. This drops the runtime image
# from ~2 GB (mcr.microsoft.com/playwright:jammy) to ~400-500 MB.
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# The chromium debian package pulls libnss3/libatk/libxkbcommon and
# friends transitively; we add fonts-liberation for default font
# fallbacks, ca-certificates for TLS, and procps so the HEALTHCHECK's
# pgrep works.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      ca-certificates \
      procps \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && useradd -r -g app -m -d /home/app app

WORKDIR /app

COPY --from=build --chown=app:app /out/pipeline /app

USER app

# Pipeline has no HTTP port; healthcheck runs the node process and
# docker reports it unhealthy if the main process exits.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f "node dist/index.js" > /dev/null || exit 1

CMD ["node", "dist/index.js"]

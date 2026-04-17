# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

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

RUN pnpm --filter @newsletter/pipeline --prod deploy /out/pipeline

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

COPY --from=build --chown=app:app /out/pipeline /app

USER app

# Pipeline has no HTTP port; healthcheck runs the node process and
# docker reports it unhealthy if the main process exits.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f "node dist/index.js" > /dev/null || exit 1

CMD ["node", "dist/index.js"]

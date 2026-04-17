# syntax=docker/dockerfile:1.7

# Build stage — uses the shared base image.
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
COPY packages/api ./packages/api

RUN pnpm --filter @newsletter/shared build \
 && pnpm --filter @newsletter/pipeline build \
 && pnpm --filter @newsletter/api build

# Keep only production deps for the runtime image.
# --legacy is required on pnpm 10+ for workspaces without inject-workspace-packages.
RUN pnpm --filter @newsletter/api --prod --legacy deploy /out/api

# Runtime stage — minimal image with Node + built artifacts.
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

RUN addgroup -S app && adduser -S -G app app

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

import { config } from "dotenv";
config({ path: "../../.env" });

if (!process.env.ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is required");
  process.exit(1);
}

import { serve } from "@hono/node-server";
import { createLogger } from "@newsletter/shared";
import { createDefaultRunsRouter } from "@api/routes/runs.js";
import {
  createDefaultPublicArchivesRouter,
  createDefaultAdminArchivesRouter,
} from "@api/routes/archives.js";
import { createDefaultSettingsRouter } from "@api/routes/settings.js";
import { createAdminRouter } from "@api/routes/admin.js";
import { requireAdmin } from "@api/auth/middleware.js";
import { buildApp } from "@api/app.js";

const logger = createLogger("api");

// Route table (REQ-012 / Phase 4):
//
// Public (no middleware):
//   GET  /api/archives              — listing
//   GET  /api/archives/:runId       — single archive read
//   POST /api/admin/login           — session issue
//   POST /api/admin/logout          — session clear
//
// Admin-gated (requireAdmin):
//   GET  /api/admin/me
//   ALL  /api/runs/*
//   GET/PUT /api/settings
//   PATCH /api/admin/archives/:runId
//   POST  /api/admin/archives/:runId/add-post
//   GET   /api/admin/archives/:runId/pool
//   POST  /api/admin/archives/:runId/promote
//
// Phase 5 will update the web client to call the relocated admin archive
// endpoints under /api/admin/archives/*.

const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;

const app = buildApp({
  sessionSecret,
  publicArchivesRouter: createDefaultPublicArchivesRouter(),
  adminArchivesRouter: createDefaultAdminArchivesRouter(),
  runsRouter: createDefaultRunsRouter(),
  settingsRouter: createDefaultSettingsRouter(),
  adminRouter: createAdminRouter({
    adminPassword,
    sessionSecret,
    logger: {
      info: (m, meta) => {
        logger.info(meta ?? {}, m);
      },
      warn: (m, meta) => {
        logger.warn(meta ?? {}, m);
      },
    },
  }),
  requireAdminFactory: requireAdmin,
});

const port = Number(process.env.API_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "API server running");
});

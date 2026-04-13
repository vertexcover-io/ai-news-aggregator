import { config } from "dotenv";
config({ path: "../../.env" });

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger } from "@newsletter/shared/logger";
import { createDefaultRunsRouter } from "./routes/runs.js";
import { createDefaultProfilesRouter } from "./routes/profiles.js";
import { createDefaultArchivesRouter } from "./routes/archives.js";

const logger = createLogger("api");

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/runs", createDefaultRunsRouter());
app.route("/api/profiles", createDefaultProfilesRouter());
app.route("/api/archives", createDefaultArchivesRouter());

const port = Number(process.env.API_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "API server running");
});

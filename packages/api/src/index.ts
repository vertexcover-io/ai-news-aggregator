import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger } from "@newsletter/shared/logger";
import { createPasswordAuth } from "./middleware/auth.js";
import { createDefaultRunsRouter } from "./routes/runs.js";

const logger = createLogger("api");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD is required");
}

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.use("/api/runs/*", createPasswordAuth(ADMIN_PASSWORD));
app.use("/api/runs", createPasswordAuth(ADMIN_PASSWORD));
app.route("/api/runs", createDefaultRunsRouter());

const port = Number(process.env.API_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "API server running");
});

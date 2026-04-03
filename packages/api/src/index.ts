import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("api");

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.API_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "API server running");
});

import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env["API_PORT"] ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on http://localhost:${info.port}`);
});

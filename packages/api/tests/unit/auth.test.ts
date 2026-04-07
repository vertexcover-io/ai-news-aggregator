import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createPasswordAuth } from "@api/middleware/auth.js";

function buildApp(password: string): Hono {
  const app = new Hono();
  app.use("*", createPasswordAuth(password));
  app.get("/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("createPasswordAuth", () => {
  it("rejects requests with no Authorization header (REQ-006)", async () => {
    const app = buildApp("secret");
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects requests with wrong password", async () => {
    const app = buildApp("secret");
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a Bearer token matching the password", async () => {
    const app = buildApp("secret");
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("accepts a raw password without Bearer prefix", async () => {
    const app = buildApp("secret");
    const res = await app.request("/protected", {
      headers: { Authorization: "secret" },
    });
    expect(res.status).toBe(200);
  });
});

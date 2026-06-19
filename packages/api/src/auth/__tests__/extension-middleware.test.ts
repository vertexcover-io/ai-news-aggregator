/**
 * requireExtensionAuth — lifts the verified bearer identity onto `tenantCtx`
 * (the same context var the cookie path sets) and rejects everything else,
 * including a session cookie token presented as a bearer (namespace isolation).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireExtensionAuth } from "../extension-middleware.js";
import { issueExtensionToken } from "../extension-token.js";
import { issueToken } from "../session.js";

const SECRET = "ext-mw-secret";
const PAYLOAD = {
  userId: "u-9",
  tenantId: "ten-9",
  role: "tenant_admin" as const,
};

function probeApp(): Hono {
  const app = new Hono();
  app.get("/probe", requireExtensionAuth(SECRET), (c) =>
    c.json({ tenantCtx: c.get("tenantCtx") }),
  );
  return app;
}

function probe(authHeader?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.Authorization = authHeader;
  return Promise.resolve(probeApp().request("/probe", { headers }));
}

describe("requireExtensionAuth", () => {
  it("sets tenantCtx from a valid bearer token", async () => {
    const res = await probe(`Bearer ${issueExtensionToken(PAYLOAD, SECRET)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantCtx: PAYLOAD });
  });

  it("401s without a Bearer header", async () => {
    expect((await probe()).status).toBe(401);
    expect((await probe("Basic xyz")).status).toBe(401);
  });

  it("401s for an invalid/garbage token", async () => {
    expect((await probe("Bearer nope.nope")).status).toBe(401);
  });

  it("401s for a session cookie token presented as a bearer", async () => {
    expect((await probe(`Bearer ${issueToken(PAYLOAD, SECRET)}`)).status).toBe(
      401,
    );
  });
});

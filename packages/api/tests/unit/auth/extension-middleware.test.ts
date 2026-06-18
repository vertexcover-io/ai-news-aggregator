import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { issueExtensionToken } from "@api/auth/extension-token.js";
import { requireExtensionAuth } from "@api/auth/extension-middleware.js";

const SECRET = "test-secret-32-bytes-xxxxxxxxxxx";

function buildApp(): Hono {
  const app = new Hono();
  app.use("/protected", requireExtensionAuth(SECRET));
  app.get("/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("requireExtensionAuth middleware", () => {
  it("test_REQ_003_middleware_accepts_valid_bearer: calls next for valid token", async () => {
    const app = buildApp();
    const token = issueExtensionToken(SECRET);
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("test_REQ_004_middleware_rejects_invalid_bearer: rejects missing Authorization header", async () => {
    const app = buildApp();
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("test_REQ_004_middleware_rejects_invalid_bearer: rejects tampered token", async () => {
    const app = buildApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer 1234567890.deadbeefdeadbeef" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-Bearer auth scheme", async () => {
    const app = buildApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });
});

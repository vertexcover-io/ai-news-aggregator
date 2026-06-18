/**
 * REQ-010: CORS scoped to chrome-extension:// origins on extension routes only.
 * Admin/runs/settings routes must remain WITHOUT any Access-Control-Allow-Origin header.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { buildApp } from "@api/app.js";
import { createExtensionRouter } from "@api/routes/extension.js";

const ADMIN_PW = "admin-pw-test";
const SESSION_SECRET = "session-secret-at-least-32-bytes-long-xxx";

function makeStubRouter(): Hono {
  const r = new Hono();
  r.all("*", (c) => c.json({ stub: true }));
  return r;
}

function makeEmptyRouter(): Hono {
  return new Hono();
}

function buildTestApp(): Hono {
  const extensionRouter = createExtensionRouter({
    adminPassword: ADMIN_PW,
    sessionSecret: SESSION_SECRET,
    getRawItemsRepo: () => {
      throw new Error("not needed for CORS test");
    },
  });

  // Use empty stubs — catch-all stubs mounted at broad paths intercept extension routes
  const empty = makeEmptyRouter();
  return buildApp({
    sessionSecret: SESSION_SECRET,
    publicArchivesRouter: empty,
    publicHomeRouter: empty,
    publicMustReadRouter: empty,
    archivesSearchRouter: empty,
    publicSourcesRouter: empty,
    adminArchivesRouter: makeStubRouter(),
    adminRunsRouter: makeStubRouter(),
    adminEvalRouter: empty,
    adminSocialCredentialsRouter: empty,
    adminMustReadRouter: empty,
    runsRouter: makeStubRouter(),
    settingsRouter: empty,
    adminRouter: makeStubRouter(),
    requireAdminFactory: () => (_c, next) => next(),
    subscribeRouter: empty,
    webhooksRouter: empty,
    analyticsRouter: empty,
    analyticsConfigRouter: empty,
    linkedInOAuthRouter: empty,
    linkedInOAuthCallbackRouter: empty,
    collectorHealthRouter: empty,
    llmTxtIndexRouter: empty,
    llmTxtArchiveRouter: empty,
    extensionRouter,
  });
}

describe("test_REQ_010_cors_scoped_to_extension_routes", () => {
  it("extension OPTIONS returns Access-Control-Allow-Origin for chrome-extension:// origin", async () => {
    const app = buildTestApp();
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const res = await app.request("/api/extension/login", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).toBe(origin);
  });

  it("extension routes do NOT reflect a non-chrome-extension origin", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/extension/login", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    // Should be empty string or null — not the evil origin
    expect(acao === null || acao === "").toBe(true);
  });

  it("admin route has no Access-Control-Allow-Origin header", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/admin/me", {
      method: "GET",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).toBeNull();
  });

  it("runs route has no Access-Control-Allow-Origin header", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/runs", {
      method: "GET",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).toBeNull();
  });
});

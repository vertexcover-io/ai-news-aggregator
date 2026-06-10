import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { PostHog } from "posthog-node";
import {
  configurePostHog,
  resetAnalyticsForTest,
  shutdownAnalytics,
} from "@api/lib/posthog.js";
import { buildApp } from "@api/app.js";
import type { BuildAppDeps } from "@api/app.js";
import type { MiddlewareHandler } from "hono";

/**
 * Build a minimal but valid BuildAppDeps with stub routers.
 */
function makeMinimalDeps(): BuildAppDeps {
  const stub = () => new Hono();
  const noop: MiddlewareHandler = async (_c, next) => { await next(); };
  const requireAdminFactory = (_secret: string): MiddlewareHandler =>
    async (_c, next) => {
      await next();
    };
  return {
    sessionSecret: "test-secret-32-bytes-xxxxxxxxxx!!",
    resolveTenant: noop,
    publicArchivesRouter: stub(),
    publicHomeRouter: stub(),
    publicMustReadRouter: stub(),
    archivesSearchRouter: stub(),
    publicSourcesRouter: stub(),
    adminArchivesRouter: stub(),
    adminRunsRouter: stub(),
    adminEvalRouter: stub(),
    adminSocialCredentialsRouter: stub(),
    adminMustReadRouter: stub(),
    runsRouter: stub(),
    settingsRouter: stub(),
    sendingDomainRouter: stub(),
    adminRouter: stub(),
    requireAdminFactory,
    subscribeRouter: stub(),
    webhooksRouter: stub(),
    analyticsRouter: stub(),
    analyticsConfigRouter: stub(),
    linkedInOAuthRouter: stub(),
    linkedInOAuthCallbackRouter: stub(),
    twitterOAuthRouter: stub(),
    twitterOAuthCallbackRouter: stub(),
    collectorHealthRouter: stub(),
    sourcesAdminRouter: stub(),
    notificationsRouter: stub(),
    featuresRouter: stub(),
    superAppCredentialsRouter: stub(),
    superAdminRouter: stub(),
  };
}

afterEach(async () => {
  await shutdownAnalytics();
  resetAnalyticsForTest();
  vi.restoreAllMocks();
});

describe("test_REQ_003_api_onerror_captures_5xx", () => {
  it("returns 500 JSON and calls captureException once with method+path for an unhandled throw", async () => {
    const captureExceptionSpy = vi
      .spyOn(PostHog.prototype, "captureException")
      .mockImplementation(vi.fn());
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    const app = buildApp(makeMinimalDeps());
    // Add a route that throws an unhandled error
    app.get("/test/throw", () => {
      throw new Error("unexpected server error");
    });

    const req = new Request("http://localhost/test/throw");
    const res = await app.fetch(req);

    // Response should be 500
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");

    // Wait for the fire-and-forget captureException to settle
    await new Promise<void>((r) => setTimeout(r, 50));

    // captureException called once with method + path context
    expect(captureExceptionSpy).toHaveBeenCalledOnce();
    const [errArg, distinctIdArg, propsArg] = captureExceptionSpy.mock
      .calls[0] as [Error, string, Record<string, unknown>];
    expect(errArg).toBeInstanceOf(Error);
    expect(errArg.message).toBe("unexpected server error");
    expect(distinctIdArg).toBe("api-server"); // no distinctId in context, defaults to "api-server"
    expect(propsArg).toMatchObject({ method: "GET", path: "/test/throw" });
  });
});

describe("test_REQ_004_api_onerror_skips_sub_500_httpexception", () => {
  it("returns 404 response and does NOT call captureException for HTTPException(404)", async () => {
    const captureExceptionSpy = vi
      .spyOn(PostHog.prototype, "captureException")
      .mockImplementation(vi.fn());
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    const app = buildApp(makeMinimalDeps());
    app.get("/test/notfound", () => {
      throw new HTTPException(404, { message: "not found" });
    });

    const req = new Request("http://localhost/test/notfound");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);

    // Wait briefly for any async fire-and-forget
    await new Promise<void>((r) => setTimeout(r, 50));

    // No capture for sub-500 HTTPException
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it("returns 401 response and does NOT call captureException for HTTPException(401)", async () => {
    const captureExceptionSpy = vi
      .spyOn(PostHog.prototype, "captureException")
      .mockImplementation(vi.fn());
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    const app = buildApp(makeMinimalDeps());
    app.get("/test/unauthorized", () => {
      throw new HTTPException(401, { message: "unauthorized" });
    });

    const req = new Request("http://localhost/test/unauthorized");
    const res = await app.fetch(req);

    expect(res.status).toBe(401);

    await new Promise<void>((r) => setTimeout(r, 50));
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });
});

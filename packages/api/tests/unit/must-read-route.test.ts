import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { PublicTenantCtx } from "@api/middleware/resolve-tenant.js";
import type { MustReadRepo } from "@api/repositories/must-read.js";
import { createPublicMustReadRouter } from "@api/routes/must-read.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function buildApp(
  publicTenant: PublicTenantCtx | undefined,
): { app: Hono; listPublic: ReturnType<typeof vi.fn> } {
  const listPublic = vi.fn(() => Promise.resolve([]));
  const repo = { listPublic } as unknown as MustReadRepo;
  const app = new Hono();
  if (publicTenant) {
    app.use("*", async (c, next) => {
      c.set("publicTenant", publicTenant);
      await next();
    });
  }
  app.route(
    "/api/must-read",
    createPublicMustReadRouter({ getMustReadRepo: () => repo }),
  );
  return { app, listPublic };
}

describe("GET /api/must-read — canon flag enforcement", () => {
  it("returns an empty list and does not query the repo when canon is off", async () => {
    const { app, listPublic } = buildApp({
      tenantId: TENANT_ID,
      slug: "inference",
      featureCanon: false,
    });
    const res = await app.request("/api/must-read");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(listPublic).not.toHaveBeenCalled();
  });

  it("queries the repo when canon is on", async () => {
    const { app, listPublic } = buildApp({
      tenantId: TENANT_ID,
      slug: "inference",
      featureCanon: true,
    });
    const res = await app.request("/api/must-read");
    expect(res.status).toBe(200);
    expect(listPublic).toHaveBeenCalledOnce();
  });

  it("queries the repo on the app host where no public tenant is resolved (legacy)", async () => {
    const { app, listPublic } = buildApp(undefined);
    const res = await app.request("/api/must-read");
    expect(res.status).toBe(200);
    expect(listPublic).toHaveBeenCalledOnce();
  });
});

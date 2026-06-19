import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { TenantRow } from "@api/repositories/tenants.js";
import type { TenantCtx } from "@api/auth/middleware.js";
import { createRequireFeature } from "@api/middleware/require-feature.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT_ID,
    slug: "inference",
    previousSlug: null,
    name: "The Inference",
    status: "active",
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    onboardingState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Builds a Hono app whose session tenant context is preset (as `requireAuth`
 * would), guarded by `requireFeature(flag)` on `/eval/*`.
 */
function buildApp(
  tenant: TenantRow | null,
  flag: "featureEval" | "featureDeliverability" | "featureCanon" = "featureEval",
  session: TenantCtx | undefined = {
    userId: "u1",
    tenantId: TENANT_ID,
    role: "tenant_admin",
  },
): { app: Hono; findById: ReturnType<typeof vi.fn> } {
  const findById = vi.fn(() => Promise.resolve(tenant));
  const requireFeature = createRequireFeature(() => ({ findById }));
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (session !== undefined) c.set("tenantCtx", session);
    await next();
  });
  app.use("/eval/*", requireFeature(flag));
  app.get("/eval/runs", (c) => c.json({ ok: true }));
  return { app, findById };
}

describe("requireFeature middleware", () => {
  it("403s feature_disabled when the tenant flag is off", async () => {
    const { app, findById } = buildApp(makeTenant({ featureEval: false }));
    const res = await app.request("/eval/runs");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "feature_disabled",
      feature: "featureEval",
    });
    expect(findById).toHaveBeenCalledWith(TENANT_ID);
  });

  it("passes through when the tenant flag is on", async () => {
    const { app } = buildApp(makeTenant({ featureEval: true }));
    const res = await app.request("/eval/runs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("403s when the tenant cannot be resolved", async () => {
    const { app } = buildApp(null);
    const res = await app.request("/eval/runs");
    expect(res.status).toBe(403);
  });

  it("403s when there is no concrete tenant in the session", async () => {
    const { app } = buildApp(makeTenant({ featureEval: true }), "featureEval", {
      userId: "super",
      tenantId: null,
      role: "super_admin",
    });
    const res = await app.request("/eval/runs");
    expect(res.status).toBe(403);
  });
});

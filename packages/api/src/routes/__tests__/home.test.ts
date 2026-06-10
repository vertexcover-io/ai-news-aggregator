import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createPublicHomeRouter } from "../home.js";
import type { RunArchivesRepo } from "../../repositories/run-archives.js";
import type { RawItemsRepo } from "../../repositories/raw-items.js";
import type { MustReadRepo } from "../../repositories/must-read.js";
import type { TenantsRepo } from "../../repositories/tenants.js";
import type { HomePagePayload } from "@newsletter/shared/types";

interface TenantRowStub {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoBytes: Uint8Array | null;
  logoContentType: string | null;
  featureCanon: boolean;
}

function makeTenantRow(overrides: Partial<TenantRowStub> = {}): TenantRowStub {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "test",
    name: "Test Tenant",
    headline: "Test Headline",
    topicStrip: "A · B · C",
    subtagline: "A test subtagline",
    logoBytes: new Uint8Array([0x89]),
    logoContentType: "image/png",
    featureCanon: false,
    ...overrides,
  };
}

function buildHomeApp(opts: {
  tenants?: TenantsRepo;
  archives?: RunArchivesRepo;
  rawItems?: RawItemsRepo;
  mustRead?: MustReadRepo;
}): Hono {
  const app = new Hono();

  // Set tenantCtx before routes so the home router reads from c.var.tenantCtx.
  app.use("*", async (c, next) => {
    c.set("tenantCtx", {
      userId: "test-user",
      tenantId: "00000000-0000-0000-0000-000000000001",
      role: "public",
    });
    await next();
  });

  app.route(
    "/api/home",
    createPublicHomeRouter({
      getTenantsRepo: () =>
        opts.tenants ?? {
          findById: vi.fn().mockResolvedValue(null),
          findBySlug: vi.fn().mockResolvedValue(null),
        } as unknown as TenantsRepo,
      getArchiveRepo: () =>
        opts.archives ?? ({
          findLatestReviewedSince: vi.fn().mockResolvedValue(null),
          listReviewed: vi.fn().mockResolvedValue([]),
        } as unknown as RunArchivesRepo),
      getRawItemsRepo: () =>
        opts.rawItems ?? ({} as unknown as RawItemsRepo),
      getMustReadRepo: () =>
        opts.mustRead ?? ({
          findRandom: vi.fn().mockResolvedValue(null),
        } as unknown as MustReadRepo),
    }),
  );
  return app;
}

describe("GET /api/home (branding)", () => {
  it("includes branding in the response payload (REQ-040)", async () => {
    const tenant = makeTenantRow();
    const repo = {
      findById: vi.fn().mockResolvedValue(tenant),
      findBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as TenantsRepo;
    const app = buildHomeApp({ tenants: repo });
    const res = await app.request("/api/home");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomePagePayload;
    expect(body.branding).toBeDefined();
    expect(body.branding.name).toBe("Test Tenant");
    expect(body.branding.headline).toBe("Test Headline");
    expect(body.branding.topicStrip).toBe("A · B · C");
    expect(body.branding.subtagline).toBe("A test subtagline");
    expect(body.branding.logoUrl).toBe("/api/logo/test");
    expect(body.branding.flags.canon).toBe(false);
    expect(body.branding.flags.isTenantZero).toBe(false);
  });

  it("sets logoUrl to null when no logo (REQ-043)", async () => {
    const tenant = makeTenantRow({ logoBytes: null, logoContentType: null });
    const repo = {
      findById: vi.fn().mockResolvedValue(tenant),
      findBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as TenantsRepo;
    const app = buildHomeApp({ tenants: repo });
    const res = await app.request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.branding.logoUrl).toBeNull();
  });

  it("sets canon=true when tenant has featureCanon (REQ-042)", async () => {
    const tenant = makeTenantRow({ featureCanon: true });
    const repo = {
      findById: vi.fn().mockResolvedValue(tenant),
      findBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as TenantsRepo;
    const app = buildHomeApp({ tenants: repo });
    const res = await app.request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.branding.flags.canon).toBe(true);
  });

  it("returns 500 when tenant lookup fails", async () => {
    const repo = {
      findById: vi.fn().mockRejectedValue(new Error("DB down")),
      findBySlug: vi.fn().mockResolvedValue(null),
    } as unknown as TenantsRepo;
    const app = buildHomeApp({ tenants: repo });
    const res = await app.request("/api/home");
    expect(res.status).toBe(500);
  });
});

import { Hono } from "hono";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import { BOOTSTRAP_TENANT_ID } from "@newsletter/shared/types/tenant-context";

export interface TenantBranding {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoUrl: string | null;
  slug: string;
  flags: {
    canon: boolean;
    deliverability: boolean;
    eval: boolean;
  };
  isTenantZero: boolean;
}

export interface TenantBrandingRepo {
  getBranding(tenantId: string): Promise<{
    name: string;
    headline: string | null;
    topicStrip: string | null;
    subtagline: string | null;
    logoContentType: string | null;
    slug: string;
    featureCanon: boolean;
    featureDeliverability: boolean;
    featureEval: boolean;
  } | null>;
  getLogo(tenantId: string): Promise<{
    logoBytes: Buffer | null;
    logoContentType: string | null;
  } | null>;
}

export function createBrandingRouter(deps: { brandingRepo: TenantBrandingRepo }): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const ctx = resolveTenantCtx(c);
    const row = await deps.brandingRepo.getBranding(ctx.tenantId);
    if (!row) {
      return c.json({ error: "tenant not found" }, 404);
    }

    const branding: TenantBranding = {
      name: row.name,
      headline: row.headline,
      topicStrip: row.topicStrip,
      subtagline: row.subtagline,
      logoUrl: row.logoContentType ? "/logo" : null,
      slug: row.slug,
      flags: {
        canon: row.featureCanon,
        deliverability: row.featureDeliverability,
        eval: row.featureEval,
      },
      isTenantZero: ctx.tenantId === BOOTSTRAP_TENANT_ID,
    };

    return c.json(branding);
  });

  return router;
}

export function createLogoRouter(deps: { brandingRepo: TenantBrandingRepo }): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const ctx = resolveTenantCtx(c);
    const row = await deps.brandingRepo.getLogo(ctx.tenantId);
    if (!row?.logoBytes || !row?.logoContentType) {
      return c.notFound();
    }

    const etag = simpleHash(row.logoBytes);
    c.header("Content-Type", row.logoContentType);
    c.header("Cache-Control", "public, max-age=86400, immutable");
    c.header("ETag", `"${etag}"`);

    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch === `"${etag}"`) {
      return c.body(null, 304);
    }

    return c.body(row.logoBytes);
  });

  return router;
}

function simpleHash(buf: Buffer): string {
  let hash = 0;
  for (let i = 0; i < Math.min(buf.length, 1024); i++) {
    hash = ((hash << 5) - hash + buf[i]) | 0;
  }
  return Math.abs(hash).toString(16);
}

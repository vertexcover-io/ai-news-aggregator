import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { getTenantId } from "@api/middleware/tenant-host.js";
import {
  MAX_LOGO_BYTES,
  validateLogo,
} from "@api/lib/logo-validation.js";
import type {
  TenantBrandingRecord,
  TenantsRepo,
} from "@api/repositories/tenants.js";

const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).optional();

const brandingBodySchema = z
  .object({
    name: optionalText(80),
    headline: optionalText(200),
    topicStrip: optionalText(300),
    subtagline: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
  })
  .strict()
  .refine((body) => Object.keys(body).some((k) => body[k as keyof typeof body] !== undefined), {
    message: "at least one branding field is required",
  });

function toWire(row: TenantBrandingRecord) {
  return {
    name: row.name,
    headline: row.headline,
    topicStrip: row.topicStrip,
    subtagline: row.subtagline,
    logoVersion: row.logoVersion,
  };
}

async function readLogoBytes(c: Context): Promise<Uint8Array | null> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const body: Record<string, string | File | undefined> =
      await c.req.parseBody();
    const file = body.logo ?? body.file;
    if (!(file instanceof File)) return null;
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Uint8Array(await c.req.arrayBuffer());
}

export interface BrandingRouterDeps {
  tenantsRepo: Pick<TenantsRepo, "updateBranding" | "setLogo">;
}

/** Tenant branding mutations (own tenant via session). Mounted admin-gated. */
export function createBrandingRouter(deps: BrandingRouterDeps): Hono {
  const app = new Hono();

  app.put("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = brandingBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    const row = await deps.tenantsRepo.updateBranding(
      getTenantId(c),
      parsed.data,
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(toWire(row));
  });

  // REQ-039/EDGE-007: validation happens before any write, so a rejected
  // upload always leaves the existing logo untouched.
  app.put("/logo", async (c) => {
    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (declaredLength > MAX_LOGO_BYTES * 2) {
      return c.json({ error: "invalid_logo", reason: "too_large" }, 422);
    }
    const bytes = await readLogoBytes(c);
    if (bytes === null) {
      return c.json({ error: "invalid_logo", reason: "empty" }, 422);
    }
    const validation = validateLogo(bytes);
    if (!validation.ok) {
      return c.json({ error: "invalid_logo", reason: validation.reason }, 422);
    }
    const logoVersion = await deps.tenantsRepo.setLogo(
      getTenantId(c),
      Buffer.from(bytes),
      validation.contentType,
    );
    if (logoVersion === null) return c.json({ error: "not_found" }, 404);
    return c.json({ logoVersion });
  });

  return app;
}

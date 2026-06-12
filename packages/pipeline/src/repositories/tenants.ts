import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";

/**
 * NOT tenant-scoped by design (mirrors the api tenants repo): this is the
 * tenant-resolution surface — workers look tenants up BY id to derive
 * per-tenant branding at send time.
 */

export interface PipelineTenantRecord {
  id: string;
  name: string;
  slug: string;
}

export interface PipelineTenantsRepo {
  findById(id: string): Promise<PipelineTenantRecord | null>;
}

export function createPipelineTenantsRepo(
  db: Pick<AppDb, "select">,
): PipelineTenantsRepo {
  return {
    async findById(id: string): Promise<PipelineTenantRecord | null> {
      const rows = await db
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}

/**
 * Phase 7 — e2e seam test for the pipeline sending-domains + tenants reads
 * that feed the broadcast gate (REQ-053) and template branding.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sendingDomains, tenants } from "@newsletter/shared/db";
import { createPipelineSendingDomainsRepo } from "@pipeline/repositories/sending-domains.js";
import { createPipelineTenantsRepo } from "@pipeline/repositories/tenants.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

async function seedTenant(
  db: AppDb,
  name: string,
): Promise<{ id: string; slug: string }> {
  const slug = `sd-e2e-${randomUUID().slice(0, 8)}`;
  const rows = await db
    .insert(tenants)
    .values({ slug, name, status: "active" })
    .returning({ id: tenants.id });
  return { id: rows[0].id, slug };
}

describe("pipeline sending-domains/tenants repos (e2e seam)", () => {
  let db: AppDb;

  beforeEach(async () => {
    db = getTestDb();
    await truncateAll(db);
  });

  it("get() returns the tenant's domain + status only for the owning tenant", async () => {
    const { id: tenantA } = await seedTenant(db, "Tenant A");
    const { id: tenantB } = await seedTenant(db, "Tenant B");
    await db.insert(sendingDomains).values({
      tenantId: tenantA,
      domain: "a.example.com",
      resendDomainId: "rd-a",
      status: "verified",
    });

    expect(await createPipelineSendingDomainsRepo(db, tenantA).get()).toEqual({
      domain: "a.example.com",
      status: "verified",
    });
    expect(await createPipelineSendingDomainsRepo(db, tenantB).get()).toBeNull();
  });

  it("tenants repo resolves branding names + slug by id", async () => {
    const { id: tenantA, slug } = await seedTenant(db, "Acme AI Weekly");
    const repo = createPipelineTenantsRepo(db);
    expect(await repo.findById(tenantA)).toEqual({
      id: tenantA,
      name: "Acme AI Weekly",
      slug,
    });
    expect(await repo.findById(randomUUID())).toBeNull();
  });
});

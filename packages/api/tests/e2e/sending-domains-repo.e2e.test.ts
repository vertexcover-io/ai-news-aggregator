/**
 * Phase 7 e2e: sending-domains repository against the real DB — upsert
 * replaces the tenant's single row (tenant_id UNIQUE), updateStatus persists
 * verification state, and rows are tenant-scoped (seam invariant).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createSendingDomainsRepo } = await import(
  "@api/repositories/sending-domains.js"
);

const db = getDb();

const SLUGS = { a: "sending-domains-e2e-a", b: "sending-domains-e2e-b" } as const;
const tenantIds = { a: "", b: "" };

const DNS_RECORDS = [
  { record: "SPF", name: "send.a.example.com", type: "TXT", value: "v=spf1", status: "pending" },
];

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM sending_domains WHERE tenant_id IN (
      SELECT id FROM tenants WHERE slug IN (${SLUGS.a}, ${SLUGS.b})
    )
  `);
  await db.execute(
    sql`DELETE FROM tenants WHERE slug IN (${SLUGS.a}, ${SLUGS.b})`,
  );
}

beforeAll(async () => {
  await cleanup();
  for (const key of ["a", "b"] as const) {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, status)
      VALUES (${SLUGS[key]}, ${`Sending Domains E2E ${key.toUpperCase()}`}, 'active')
      RETURNING id
    `);
    tenantIds[key] = rows[0].id;
  }
});

afterAll(async () => {
  await cleanup();
});

describe("createSendingDomainsRepo (e2e)", () => {
  it("get() is null before registration; upsert() persists and replaces (one row per tenant)", async () => {
    const repo = createSendingDomainsRepo(db, tenantIds.a);
    expect(await repo.get()).toBeNull();

    const first = await repo.upsert({
      domain: "a.example.com",
      resendDomainId: "rd-a-1",
      status: "pending",
      dnsRecords: DNS_RECORDS,
      failureReason: null,
    });
    expect(first.domain).toBe("a.example.com");
    expect(first.status).toBe("pending");
    expect(first.dnsRecords).toEqual(DNS_RECORDS);

    // Re-registering a different domain replaces the row instead of adding one.
    const second = await repo.upsert({
      domain: "a2.example.com",
      resendDomainId: "rd-a-2",
      status: "pending",
      dnsRecords: null,
      failureReason: null,
    });
    expect(second.domain).toBe("a2.example.com");
    const current = await repo.get();
    expect(current?.domain).toBe("a2.example.com");
    expect(current?.resendDomainId).toBe("rd-a-2");
  });

  it("updateStatus() persists verification state + failure reason (REQ-085)", async () => {
    const repo = createSendingDomainsRepo(db, tenantIds.a);
    const checkedAt = new Date();
    const updated = await repo.updateStatus({
      status: "failed",
      dnsRecords: DNS_RECORDS.map((r) => ({ ...r, status: "failed" })),
      failureReason: "SPF record (TXT send.a.example.com): failed",
      lastCheckedAt: checkedAt,
    });
    expect(updated?.status).toBe("failed");
    expect(updated?.failureReason).toContain("SPF record");
    expect(updated?.lastCheckedAt?.getTime()).toBe(checkedAt.getTime());
  });

  it("rows are tenant-scoped — tenant B sees null, B's updateStatus touches nothing of A", async () => {
    const repoB = createSendingDomainsRepo(db, tenantIds.b);
    expect(await repoB.get()).toBeNull();
    expect(
      await repoB.updateStatus({
        status: "verified",
        dnsRecords: null,
        failureReason: null,
        lastCheckedAt: new Date(),
      }),
    ).toBeNull();

    const repoA = createSendingDomainsRepo(db, tenantIds.a);
    expect((await repoA.get())?.status).toBe("failed");
  });
});

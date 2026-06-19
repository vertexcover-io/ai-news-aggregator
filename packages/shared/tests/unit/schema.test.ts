import { describe, expect, it } from "vitest";
import type { RawItemInsert, TenantInsert, UserInsert } from "@shared/db/schema.js";
import type {
  RunSubmitTwitterConfig,
  RunSubmitTwitterUser,
  RunCollectorsPayload,
} from "@shared/types/run.js";

// REQ-001 — raw_items.run_id column
describe("schema: rawItems — run_id column (REQ-001)", () => {
  it("RawItemInsert accepts runId as a uuid string", () => {
    const insert: RawItemInsert = {
      sourceType: "hn",
      externalId: "ext-1",
      title: "Test",
      url: "https://example.com",
      collectedAt: new Date(),
      runId: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(insert.runId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("RawItemInsert accepts omitting runId (add-post path with no run context)", () => {
    const insert: RawItemInsert = {
      sourceType: "rss",
      externalId: "ext-2",
      title: "Test 2",
      url: "https://example2.com",
      collectedAt: new Date(),
    };
    // runId is absent — must compile and be undefined at runtime
    expect(insert.runId).toBeUndefined();
  });
});

// REQ-010 foundation — tenancy schema is purely additive in P1
describe("schema: tenancy (REQ-010)", () => {
  it("RawItemInsert accepts omitting tenantId (legacy rows stay NULL until P2 backfill)", () => {
    const insert: RawItemInsert = {
      sourceType: "hn",
      externalId: "ext-tenancy",
      title: "Test",
      url: "https://example.com",
      collectedAt: new Date(),
    };
    expect(insert.tenantId).toBeUndefined();
  });

  it("TenantInsert needs only slug + name (status defaults to pending_setup)", () => {
    const insert: TenantInsert = { slug: "acme", name: "Acme" };
    expect(insert.status).toBeUndefined();
  });

  it("UserInsert accepts a super_admin without tenantId", () => {
    const insert: UserInsert = {
      email: "root@example.com",
      name: "Root",
      passwordHash: "hash",
      role: "super_admin",
    };
    expect(insert.tenantId).toBeUndefined();
  });
});

describe("types: RunSubmitTwitterConfig", () => {
  it("accepts a fully-populated value with users and lists", () => {
    const user: RunSubmitTwitterUser = { handle: "jack", userId: "12" };
    const cfg: RunSubmitTwitterConfig = {
      listIds: ["1585430245762441216"],
      users: [user],
      maxTweetsPerSource: 100,
      sinceHours: 24,
    };
    expect(cfg.listIds).toHaveLength(1);
    expect(cfg.users[0].userId).toBe("12");
  });

  it("accepts a value without optional caps", () => {
    const cfg: RunSubmitTwitterConfig = {
      listIds: [],
      users: [],
    };
    expect(cfg.users).toEqual([]);
  });

  it("RunCollectorsPayload includes optional twitter slot", () => {
    const payload: RunCollectorsPayload = {
      twitter: { listIds: ["1"], users: [] },
    };
    expect(payload.twitter?.listIds).toEqual(["1"]);
  });
});

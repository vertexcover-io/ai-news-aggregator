import { describe, expect, it } from "vitest";
import type { RawItemInsert } from "@shared/db/schema.js";
import {
  tenants,
  users,
  rawItems,
  runArchives,
  runLogs,
  reviewEdits,
  emailSends,
  subscribers,
  feedbackEvents,
  sesEvents,
  evalRuns,
  mustReadEntries,
  userSettings,
  socialCredentials,
  socialTokens,
} from "@shared/db/schema.js";
import { RESERVED_SLUGS } from "@shared/constants/slugs.js";
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

// Phase 1: Multi-tenant schema (REQ-010)
describe("schema: tenancy tables and columns (REQ-010)", () => {
  it("tenants table exists with expected columns", () => {
    expect(tenants).toBeDefined();
    // Spot-check key columns
    expect(tenants.id).toBeDefined();
    expect(tenants.slug).toBeDefined();
    expect(tenants.name).toBeDefined();
    expect(tenants.status).toBeDefined();
    expect(tenants.customDomain).toBeDefined();
    expect(tenants.headline).toBeDefined();
    expect(tenants.topicStrip).toBeDefined();
    expect(tenants.subtagline).toBeDefined();
    expect(tenants.logoBytes).toBeDefined();
    expect(tenants.logoContentType).toBeDefined();
    expect(tenants.featureCanon).toBeDefined();
    expect(tenants.featureDeliverability).toBeDefined();
    expect(tenants.featureEval).toBeDefined();
    expect(tenants.onboardingState).toBeDefined();
    expect(tenants.createdAt).toBeDefined();
    expect(tenants.updatedAt).toBeDefined();
  });

  it("users table exists with expected columns", () => {
    expect(users).toBeDefined();
    expect(users.id).toBeDefined();
    expect(users.tenantId).toBeDefined();
    expect(users.email).toBeDefined();
    expect(users.name).toBeDefined();
    expect(users.passwordHash).toBeDefined();
    expect(users.role).toBeDefined();
    expect(users.createdAt).toBeDefined();
    expect(users.updatedAt).toBeDefined();
  });

  const TENANT_OWNED_TABLES = [
    "rawItems",
    "runArchives",
    "runLogs",
    "reviewEdits",
    "emailSends",
    "subscribers",
    "feedbackEvents",
    "sesEvents",
    "evalRuns",
    "mustReadEntries",
    "userSettings",
    "socialCredentials",
    "socialTokens",
  ] as const;

  it.each(TENANT_OWNED_TABLES)("%s has a nullable tenant_id column", (tableName) => {
    const tableMap: Record<string, unknown> = {
      rawItems,
      runArchives,
      runLogs,
      reviewEdits,
      emailSends,
      subscribers,
      feedbackEvents,
      sesEvents,
      evalRuns,
      mustReadEntries,
      userSettings,
      socialCredentials,
      socialTokens,
    };
    const table = tableMap[tableName];
    expect(table, `Table ${tableName} should be defined`).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantIdCol = (table as any).tenantId;
    expect(tenantIdCol, `${tableName} should have tenantId column`).toBeDefined();
  });

  it("RESERVED_SLUGS has at least 30 reserved words", () => {
    expect(Array.isArray(RESERVED_SLUGS)).toBe(true);
    expect(RESERVED_SLUGS.length).toBeGreaterThanOrEqual(30);
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

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { RawItemInsert } from "@shared/db/schema.js";
import {
  emailSends,
  evalRuns,
  feedbackEvents,
  mustReadEntries,
  rawItems,
  reviewEdits,
  runArchives,
  runLogs,
  sendingDomains,
  sesEvents,
  socialCredentials,
  socialTokens,
  sources,
  subscribers,
  userSettings,
} from "@shared/db/schema.js";
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

// REQ-010 — every tenant-owned table carries tenant_id
describe("schema: tenant-owned tables expose tenantId (REQ-010)", () => {
  const tenantOwnedTables = [
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
    sources,
    sendingDomains,
  ];

  it.each(tenantOwnedTables.map((t) => [getTableName(t), t] as const))(
    "%s has a non-null tenant_id column",
    (_name, table) => {
      const columns = getTableColumns(table);
      expect(columns).toHaveProperty("tenantId");
      expect(columns.tenantId.name).toBe("tenant_id");
      expect(columns.tenantId.notNull).toBe(true);
    },
  );
});

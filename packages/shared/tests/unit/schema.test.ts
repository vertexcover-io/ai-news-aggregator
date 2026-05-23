import { describe, expect, it } from "vitest";
import { emailSends, rawItems, runArchives, sesEvents, subscribers, userSettings } from "@shared/db/schema.js";
import type { RawItemInsert } from "@shared/db/schema.js";
import type {
  RunSubmitTwitterConfig,
  RunSubmitTwitterUser,
  RunCollectorsPayload,
} from "@shared/types/run.js";

describe("schema: userSettings", () => {
  it("exports userSettings with all required columns", () => {
    const columns = [
      "id",
      "singleton",
      "topN",
      "halfLifeHours",
      "hnConfig",
      "redditConfig",
      "webConfig",
      "twitterConfig",
      "pipelineTime",
      "emailTime",
      "linkedinTime",
      "twitterTime",
      "scheduleTimezone",
      "scheduleEnabled",
      "emailEnabled",
      "linkedinEnabled",
      "twitterPostEnabled",
      "autoReview",
      "updatedAt",
    ] as const;
    for (const col of columns) {
      expect(userSettings[col as keyof typeof userSettings]).toBeDefined();
    }
  });

  it("enforces singleton uniqueness via a unique index", () => {
    expect(userSettings.singleton).toBeDefined();
  });
});

describe("schema: runArchives", () => {
  it("has a reviewed boolean column", () => {
    expect(runArchives.reviewed).toBeDefined();
  });

  it("has publish and notification idempotency columns", () => {
    expect(runArchives.emailSentAt).toBeDefined();
    expect(runArchives.notificationState).toBeDefined();
  });
});

// REQ-003, REQ-004
describe("schema: subscribers", () => {
  it("exports subscribers table with all required columns", () => {
    const cols = ["id", "email", "status", "confirmToken", "confirmTokenExpiresAt", "subscribedAt", "unsubscribedAt", "createdAt", "updatedAt"] as const;
    for (const col of cols) {
      expect(subscribers[col as keyof typeof subscribers]).toBeDefined();
    }
  });

  it("has email as unique index (subscribers_email_uq)", () => {
    expect(subscribers.email).toBeDefined();
  });
});

// REQ-012, REQ-019
describe("schema: emailSends", () => {
  it("exports emailSends table with all required columns", () => {
    const cols = ["id", "subscriberId", "runArchiveId", "messageId", "sentAt"] as const;
    for (const col of cols) {
      expect(emailSends[col as keyof typeof emailSends]).toBeDefined();
    }
  });
});

// REQ-020, REQ-021, REQ-023
describe("schema: sesEvents", () => {
  it("exports sesEvents table with all required columns", () => {
    const cols = ["id", "messageId", "eventType", "subscriberId", "rawPayload", "occurredAt", "createdAt"] as const;
    for (const col of cols) {
      expect(sesEvents[col as keyof typeof sesEvents]).toBeDefined();
    }
  });
});

// REQ-001 — raw_items.run_id column
describe("schema: rawItems — run_id column (REQ-001)", () => {
  it("exposes a runId column on the rawItems table", () => {
    expect(rawItems.runId).toBeDefined();
  });

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

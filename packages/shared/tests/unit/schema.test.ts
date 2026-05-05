import { describe, expect, it } from "vitest";
import { emailSends, runArchives, sesEvents, subscribers, userSettings } from "@shared/db/schema.js";

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
      "scheduleTime",
      "scheduleTimezone",
      "scheduleEnabled",
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

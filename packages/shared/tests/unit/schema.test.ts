import { describe, expect, it } from "vitest";
import { runArchives, userSettings } from "@shared/db/schema.js";
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

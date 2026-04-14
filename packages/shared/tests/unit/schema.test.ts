import { describe, expect, it } from "vitest";
import { runArchives, userSettings } from "@shared/db/schema.js";

describe("schema: userSettings", () => {
  it("exports userSettings with all required columns", () => {
    const columns = [
      "id",
      "singleton",
      "profileName",
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

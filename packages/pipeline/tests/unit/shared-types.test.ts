import { describe, it, expect } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig, HnCollectJobData } from "@pipeline/types.js";

// REQ-010, REQ-011: HnCollectConfig supports configurable keywords and points threshold
describe("HnCollectConfig", () => {
  it("accepts all optional fields", () => {
    const config: HnCollectConfig = {
      keywords: ["AI", "LLM"],
      pointsThreshold: 50,
      count: 30,
    };
    expect(config.keywords).toEqual(["AI", "LLM"]);
    expect(config.pointsThreshold).toBe(50);
    expect(config.count).toBe(30);
  });

  it("accepts an empty config with no fields", () => {
    const config: HnCollectConfig = {};
    expect(config.keywords).toBeUndefined();
    expect(config.pointsThreshold).toBeUndefined();
    expect(config.count).toBeUndefined();
  });
});

// REQ-001: HnCollectJobData defines the job payload shape
describe("HnCollectJobData", () => {
  it("requires sourceId and config", () => {
    const jobData: HnCollectJobData = {
      sourceId: 1,
      config: { keywords: ["GPT"], pointsThreshold: 20 },
    };
    expect(jobData.sourceId).toBe(1);
    expect(jobData.config.keywords).toEqual(["GPT"]);
    expect(jobData.config.pointsThreshold).toBe(20);
  });
});

// REQ-009: CollectorResult defines collection metrics
describe("CollectorResult", () => {
  it("has all required metric fields", () => {
    const result: CollectorResult = {
      itemsFetched: 10,
      commentsFetched: 25,
      itemsStored: 8,
      durationMs: 1500,
    };
    expect(result.itemsFetched).toBe(10);
    expect(result.commentsFetched).toBe(25);
    expect(result.itemsStored).toBe(8);
    expect(result.durationMs).toBe(1500);
  });
});

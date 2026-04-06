import { describe, it, expect } from "vitest";
import type { WebCollectConfig, WebCollectJobData } from "@pipeline/types";

describe("WebCollectConfig", () => {
  it("requires urls array and sourceType", () => {
    const config: WebCollectConfig = {
      urls: ["https://example.com/blog/post-1", "https://example.com/blog/post-2"],
      sourceType: "blog",
    };

    expect(config.urls).toHaveLength(2);
    expect(config.sourceType).toBe("blog");
  });

  it("accepts rss sourceType", () => {
    const config: WebCollectConfig = {
      urls: ["https://example.com/feed/item-1"],
      sourceType: "rss",
    };

    expect(config.sourceType).toBe("rss");
  });

  it("works with empty urls array", () => {
    const config: WebCollectConfig = {
      urls: [],
      sourceType: "blog",
    };

    expect(config.urls).toHaveLength(0);
  });
});

describe("WebCollectJobData", () => {
  it("wraps WebCollectConfig in a config field", () => {
    const jobData: WebCollectJobData = {
      config: {
        urls: ["https://example.com/post"],
        sourceType: "blog",
      },
    };

    expect(jobData.config).toBeDefined();
    expect(jobData.config.urls).toEqual(["https://example.com/post"]);
  });
});

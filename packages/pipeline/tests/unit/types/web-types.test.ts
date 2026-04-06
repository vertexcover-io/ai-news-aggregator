import { describe, it, expect } from "vitest";
import type {
  WebSourceSelectors,
  WebSourceConfig,
  WebCollectConfig,
  WebCollectJobData,
} from "@pipeline/types";

// REQ-001, REQ-002: WebSourceSelectors defines CSS selectors for article extraction
describe("WebSourceSelectors", () => {
  it("requires articleLink, title, and content selectors", () => {
    const selectors: WebSourceSelectors = {
      articleLink: "a.post-link",
      title: "h1.title",
      content: "div.content",
    };

    expect(selectors.articleLink).toBe("a.post-link");
    expect(selectors.title).toBe("h1.title");
    expect(selectors.content).toBe("div.content");
  });

  it("accepts optional author and date selectors", () => {
    const selectors: WebSourceSelectors = {
      articleLink: "a",
      title: "h1",
      content: "p",
      author: "span.author",
      date: "time",
    };

    expect(selectors.author).toBe("span.author");
    expect(selectors.date).toBe("time");
  });
});

// REQ-004: sourceType is "blog" or "rss"
describe("WebSourceConfig", () => {
  it("requires name, sourceType, indexUrl, and selectors", () => {
    const config: WebSourceConfig = {
      name: "Test Blog",
      sourceType: "blog",
      indexUrl: "https://example.com/blog",
      selectors: {
        articleLink: "a",
        title: "h1",
        content: "p",
      },
    };

    expect(config.name).toBe("Test Blog");
    expect(config.sourceType).toBe("blog");
    expect(config.indexUrl).toBe("https://example.com/blog");
    expect(config.selectors.articleLink).toBe("a");
  });

  it("accepts sourceType rss", () => {
    const config: WebSourceConfig = {
      name: "Test RSS",
      sourceType: "rss",
      indexUrl: "https://example.com/feed",
      selectors: {
        articleLink: "a",
        title: "h1",
        content: "div",
      },
    };

    expect(config.sourceType).toBe("rss");
  });

  // REQ-013: maxItems limits articles collected per source
  it("accepts optional maxItems", () => {
    const config: WebSourceConfig = {
      name: "Test",
      sourceType: "blog",
      indexUrl: "https://example.com",
      selectors: {
        articleLink: "a",
        title: "h1",
        content: "p",
      },
      maxItems: 5,
    };

    expect(config.maxItems).toBe(5);
  });
});

describe("WebCollectConfig", () => {
  it("contains an array of WebSourceConfig", () => {
    const config: WebCollectConfig = {
      sources: [
        {
          name: "Blog A",
          sourceType: "blog",
          indexUrl: "https://a.com",
          selectors: { articleLink: "a", title: "h1", content: "p" },
        },
        {
          name: "Blog B",
          sourceType: "rss",
          indexUrl: "https://b.com",
          selectors: { articleLink: "a", title: "h1", content: "div" },
        },
      ],
    };

    expect(config.sources).toHaveLength(2);
    expect(config.sources[0].name).toBe("Blog A");
    expect(config.sources[1].sourceType).toBe("rss");
  });
});

describe("WebCollectJobData", () => {
  it("wraps WebCollectConfig in a config field", () => {
    const jobData: WebCollectJobData = {
      config: {
        sources: [],
      },
    };

    expect(jobData.config).toBeDefined();
    expect(jobData.config.sources).toEqual([]);
  });
});

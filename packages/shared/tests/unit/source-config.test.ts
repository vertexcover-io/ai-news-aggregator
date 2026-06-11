/**
 * Unit: per-tenant source config helpers (P8, REQ-070/072).
 *
 * `buildSourceConfig` maps the Settings "Add manually" inputs (type select +
 * one text input) to a typed SourceConfig row payload; `sourceDisplayName`
 * derives the list label the Settings sources panel renders.
 */
import { describe, it, expect } from "vitest";
import {
  buildSourceConfig,
  sourceDisplayName,
} from "@shared/types/source.js";

describe("test_REQ_072_build_source_config_from_manual_input", () => {
  it.each([
    [
      "reddit",
      "r/LocalLLaMA",
      { kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 },
    ],
    [
      "reddit",
      "MachineLearning",
      { kind: "reddit", subreddit: "MachineLearning", sinceDays: 1 },
    ],
    [
      "twitter",
      "@tri_dao",
      { kind: "twitter_user", handle: "tri_dao" },
    ],
    [
      "blog",
      "https://vllm.ai/blog",
      { kind: "web", name: "vllm.ai", listingUrl: "https://vllm.ai/blog" },
    ],
    [
      "github",
      "https://github.com/trending",
      { kind: "web", name: "github.com", listingUrl: "https://github.com/trending" },
    ],
    [
      "hn",
      "",
      { kind: "hn", sinceDays: 1 },
    ],
    [
      "web_search",
      "speculative decoding",
      {
        kind: "web_search",
        provider: "tavily",
        query: "speculative decoding",
        sinceDays: 7,
        maxItems: 10,
      },
    ],
  ] as const)("%s + %j → config", (type, value, expected) => {
    expect(buildSourceConfig(type, value)).toEqual(expected);
  });

  it("rejects an invalid listing URL for web-backed types", () => {
    expect(() => buildSourceConfig("blog", "not a url")).toThrow(/url/i);
  });

  it("rejects an empty value for types that need one", () => {
    expect(() => buildSourceConfig("reddit", "  ")).toThrow(/required/i);
    expect(() => buildSourceConfig("twitter", "")).toThrow(/required/i);
    expect(() => buildSourceConfig("web_search", "")).toThrow(/required/i);
  });
});

describe("sourceDisplayName", () => {
  it.each([
    [{ kind: "hn", sinceDays: 1 }, "Hacker News"],
    [{ kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 }, "r/LocalLLaMA"],
    [{ kind: "twitter_user", handle: "tri_dao" }, "@tri_dao"],
    [{ kind: "twitter_list", listId: "123" }, "List 123"],
    [
      { kind: "web", name: "vLLM blog", listingUrl: "https://vllm.ai/blog" },
      "vLLM blog",
    ],
    [
      {
        kind: "web_search",
        provider: "tavily",
        query: "agentic ai",
        sinceDays: 7,
        maxItems: 10,
      },
      "“agentic ai”",
    ],
  ] as const)("%j → %s", (config, expected) => {
    expect(sourceDisplayName(config)).toBe(expected);
  });
});

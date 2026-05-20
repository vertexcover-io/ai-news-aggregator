import { describe, it, expect, vi } from "vitest";

// Mock @tavily/core so the factory test doesn't need a real API key
vi.mock("@tavily/core", () => ({
  tavily: (_opts: { apiKey: string }) => ({ search: vi.fn() }),
}));

import { createWebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";
import { TavilyProvider } from "@pipeline/collectors/web-search/providers/tavily.js";

describe("createWebSearchProvider", () => {
  it("throws when tavilyApiKey is missing", () => {
    expect(() => createWebSearchProvider("tavily", {})).toThrow(
      /TAVILY_API_KEY/,
    );
  });

  it("throws when tavilyApiKey is undefined explicitly", () => {
    expect(() =>
      createWebSearchProvider("tavily", { tavilyApiKey: undefined }),
    ).toThrow(/TAVILY_API_KEY/);
  });

  it("returns a TavilyProvider instance when apiKey is provided", () => {
    const provider = createWebSearchProvider("tavily", {
      tavilyApiKey: "test-key",
    });
    expect(provider).toBeInstanceOf(TavilyProvider);
  });

  it("returned provider has name 'tavily'", () => {
    const provider = createWebSearchProvider("tavily", {
      tavilyApiKey: "test-key",
    });
    expect(provider.name).toBe("tavily");
  });
});

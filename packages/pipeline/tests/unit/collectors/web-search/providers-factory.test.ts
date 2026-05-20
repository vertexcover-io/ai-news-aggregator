import { describe, it, expect, vi } from "vitest";
import { createWebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";

vi.mock("@tavily/core", () => ({
  tavily: () => ({ search: vi.fn() }),
}));

describe("createWebSearchProvider", () => {
  it('returns a TavilyProvider with name "tavily"', () => {
    const provider = createWebSearchProvider("tavily", { tavilyApiKey: "key" });
    expect(provider.name).toBe("tavily");
  });

  it("throws when tavilyApiKey is missing", () => {
    expect(() => createWebSearchProvider("tavily", {})).toThrow(/TAVILY_API_KEY/);
  });

  it("throws when tavilyApiKey is empty string", () => {
    expect(() =>
      createWebSearchProvider("tavily", { tavilyApiKey: "" }),
    ).toThrow(/TAVILY_API_KEY/);
  });
});

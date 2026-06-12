import { describe, it, expect, vi } from "vitest";
import {
  createAnthropicCandidateFilter,
  createDefaultSourceDiscovery,
  createTavilySearch,
  SourceDiscoveryError,
} from "@api/services/source-discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createDefaultSourceDiscovery", () => {
  it("returns null when TAVILY_API_KEY is unset (discovery disabled)", () => {
    expect(
      createDefaultSourceDiscovery({ ANTHROPIC_API_KEY: "sk-ant-x" }),
    ).toBeNull();
    expect(
      createDefaultSourceDiscovery({ TAVILY_API_KEY: "  ", ANTHROPIC_API_KEY: "sk-ant-x" }),
    ).toBeNull();
  });

  it("returns null when ANTHROPIC_API_KEY is unset", () => {
    expect(createDefaultSourceDiscovery({ TAVILY_API_KEY: "tvly-x" })).toBeNull();
  });

  it("returns a discovery instance when both keys are set; no fetch happens at construction", () => {
    const fetchFn = vi.fn();
    const discovery = createDefaultSourceDiscovery(
      { TAVILY_API_KEY: "tvly-x", ANTHROPIC_API_KEY: "sk-ant-x" },
      fetchFn as unknown as typeof fetch,
    );
    expect(discovery).not.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("createTavilySearch", () => {
  it("POSTs the query with a bearer key and maps results", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          results: [
            { title: "Simon Willison", url: "https://simonwillison.net", content: "LLM notes" },
          ],
        }),
      ),
    );
    const search = createTavilySearch("tvly-key", fetchFn as unknown as typeof fetch);
    const hits = await search("ai news sources");
    expect(hits).toEqual([
      { title: "Simon Willison", url: "https://simonwillison.net", content: "LLM notes" },
    ]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tvly-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "ai news sources" });
  });

  it("throws SourceDiscoveryError on a non-2xx response", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response("nope", { status: 401 })));
    const search = createTavilySearch("bad-key", fetchFn as unknown as typeof fetch);
    await expect(search("x")).rejects.toBeInstanceOf(SourceDiscoveryError);
  });
});

describe("createAnthropicCandidateFilter", () => {
  const hits = [{ title: "t", url: "https://u.example.com", content: "c" }];

  it("parses a JSON candidate array out of the model response", async () => {
    const candidates = [
      { type: "web", title: "Blog", url: "https://u.example.com", description: "d" },
    ];
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          content: [{ type: "text", text: JSON.stringify(candidates) }],
        }),
      ),
    );
    const filter = createAnthropicCandidateFilter("sk-ant", fetchFn as unknown as typeof fetch);
    expect(await filter("ai", hits)).toEqual(candidates);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("throws SourceDiscoveryError on invalid JSON or unexpected shapes", async () => {
    const badJson = vi.fn(() =>
      Promise.resolve(jsonResponse({ content: [{ type: "text", text: "not json" }] })),
    );
    await expect(
      createAnthropicCandidateFilter("sk", badJson as unknown as typeof fetch)("ai", hits),
    ).rejects.toBeInstanceOf(SourceDiscoveryError);

    const badShape = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ content: [{ type: "text", text: JSON.stringify([{ nope: 1 }]) }] }),
      ),
    );
    await expect(
      createAnthropicCandidateFilter("sk", badShape as unknown as typeof fetch)("ai", hits),
    ).rejects.toBeInstanceOf(SourceDiscoveryError);
  });
});

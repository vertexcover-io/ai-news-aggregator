import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedItem } from "@newsletter/shared";
import { patchArchive, addPost } from "../../../src/api/archives";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sampleItem: RankedItem = {
  id: 1,
  rawItemId: 101,
  title: "Story",
  url: "https://example.com",
  sourceType: "hn",
  author: null,
  publishedAt: null,
  engagement: { points: 5, commentCount: 2 },
  score: 0.9,
  rationale: "good",
  content: null,
  imageUrl: null,
  recap: null,
  enrichedSource: null,
  sourceIdentifier: "news.ycombinator.com",
  preview: { kind: "none" },
};

describe("patchArchive", () => {
  it("PATCHes /api/archives/:runId with rankedItems body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await patchArchive("run-1", {
      rankedItems: [{ id: 1, sourceType: "hn" }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/archives/run-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      rankedItems: [{ id: 1, sourceType: "hn" }],
    });
  });

  it("throws server error on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    );
    await expect(
      patchArchive("run-1", { rankedItems: [{ id: 1, sourceType: "hn" }] }),
    ).rejects.toThrow("bad");
  });
});

describe("addPost", () => {
  it("POSTs /api/archives/:runId/add-post with { url } only and returns RankedItem", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleItem), { status: 200 }),
    );
    const out = await addPost("run-1", {
      url: "https://example.com/article",
    });
    expect(out).toEqual(sampleItem);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/archives/run-1/add-post");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ url: "https://example.com/article" });
    expect(body).not.toHaveProperty("sourceType");
  });

  it("throws server error message on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "upstream failed" }), {
        status: 502,
      }),
    );
    await expect(
      addPost("run-1", { url: "https://x.com" }),
    ).rejects.toThrow("upstream failed");
  });
});

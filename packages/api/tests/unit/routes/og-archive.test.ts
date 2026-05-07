import { describe, it, expect, vi } from "vitest";
import { createOgArchiveRouter } from "@api/routes/og-archive.js";
import type { RawItemRow, RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";

function makeArchiveRepo(row: RunArchiveRow | null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() => Promise.resolve(row as RunArchiveRow)),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
    markSlackNotified: vi.fn(() => Promise.resolve()),
  };
}

function makeRawItemsRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn((ids: number[]) =>
      Promise.resolve(rows.filter((r) => ids.includes(r.id))),
    ),
  };
}

const completedAt = new Date("2026-05-07T09:18:05.421Z");

function makeRow(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: [{ rawItemId: 42, score: 1, rationale: "" }],
    topN: 5,
    reviewed: true,
    completedAt,
    createdAt: completedAt,
    startedAt: null,
    sourceTypes: null,
    digestHeadline: "AI digest headline",
    digestSummary: "A digest summary describing today's stories.",
    sourceTelemetry: null,
    slackNotifiedAt: null,
    ...overrides,
  };
}

function makeRaw(overrides: Partial<RawItemRow> = {}): RawItemRow {
  return {
    id: 42,
    sourceType: "hn",
    title: "Lead story",
    url: "https://example.com",
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    content: null,
    imageUrl: "https://cdn.example.com/lead.png",
    metadata: { comments: [] },
    ...overrides,
  };
}

function makeApp(
  row: RunArchiveRow | null,
  raws: RawItemRow[] = [],
  webBaseUrl = "https://news.vertexcover.io",
) {
  return createOgArchiveRouter({
    getArchiveRepo: () => makeArchiveRepo(row),
    getRawItemsRepo: () => makeRawItemsRepo(raws),
    webBaseUrl,
  });
}

describe("GET /:runId (og-archive router)", () => {
  it("renders og:title and og:description from the digest fields", async () => {
    const app = makeApp(makeRow(), [makeRaw()]);
    const res = await app.request("/run-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain('<meta property="og:title" content="AI digest headline"');
    expect(body).toContain(
      '<meta property="og:description" content="A digest summary describing today&#39;s stories."',
    );
    expect(body).toContain(
      '<meta property="og:url" content="https://news.vertexcover.io/archive/run-1"',
    );
    expect(body).toContain('<meta property="og:type" content="article"');
  });

  it("includes og:image and twitter:card=summary_large_image when lead story has an image", async () => {
    const app = makeApp(makeRow(), [makeRaw()]);
    const res = await app.request("/run-1");
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:image" content="https://cdn.example.com/lead.png"',
    );
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it("falls back to twitter:card=summary when no image is available", async () => {
    const app = makeApp(makeRow(), [makeRaw({ imageUrl: null })]);
    const res = await app.request("/run-1");
    const body = await res.text();
    expect(body).not.toContain('property="og:image"');
    expect(body).toContain('<meta name="twitter:card" content="summary"');
  });

  it("falls back to dated title when digestHeadline is null", async () => {
    const app = makeApp(makeRow({ digestHeadline: null }), [makeRaw()]);
    const res = await app.request("/run-1");
    const body = await res.text();
    expect(body).toMatch(/og:title" content="AI news - May 7, 2026"/);
  });

  it("falls back to generic description when digestSummary is null", async () => {
    const app = makeApp(makeRow({ digestSummary: null }), [makeRaw()]);
    const res = await app.request("/run-1");
    const body = await res.text();
    expect(body).toContain(
      "A hand-curated daily digest of what&#39;s actually moving in AI.",
    );
  });

  it("returns generic fallbacks (200) when archive does not exist", async () => {
    const app = makeApp(null);
    const res = await app.request("/missing");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta property="og:title" content="AI news digest"');
  });

  it("escapes HTML special characters in digest fields", async () => {
    const app = makeApp(
      makeRow({
        digestHeadline: 'Hello "world" & <stuff>',
        digestSummary: "5 < 6 & 7 > 6",
      }),
      [makeRaw({ imageUrl: null })],
    );
    const res = await app.request("/run-1");
    const body = await res.text();
    expect(body).not.toContain("<stuff>");
    expect(body).toContain("&lt;stuff&gt;");
    expect(body).toContain("&quot;world&quot;");
    expect(body).toContain("5 &lt; 6");
  });

  it("includes a meta refresh redirect to the SPA URL", async () => {
    const app = makeApp(makeRow(), [makeRaw()]);
    const res = await app.request("/run-1");
    const body = await res.text();
    expect(body).toContain(
      '<meta http-equiv="refresh" content="0; url=https://news.vertexcover.io/archive/run-1"',
    );
  });
});

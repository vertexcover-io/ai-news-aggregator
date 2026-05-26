import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { Configuration } from "crawlee";
import { runWebCrawl } from "@pipeline/services/web-crawler.js";
import { startFixtureServer, stopFixtureServer } from "@pipeline-tests/fixtures/web/server.js";
import type { Server } from "http";

describe("e2e: AdaptivePlaywrightCrawler against in-process fixture server", () => {
  let baseUrl: string;
  let server: Server;

  beforeAll(async () => {
    // REQ-09: disable on-disk Crawlee storage globally before any test
    Configuration.getGlobalConfig().set("persistStorage", false);

    const result = await startFixtureServer({
      "/article": "article-with-og.html",
      "/listing": "listing-blog-index.html",
    });
    server = result.server;
    baseUrl = result.baseUrl;
  });

  afterAll(async () => {
    await stopFixtureServer(server);
  });

  it("processes a listing job and returns a healthy ConvertResult", async () => {
    const out = await runWebCrawl([
      { kind: "listing", sourceName: "fixture", url: `${baseUrl}/listing` },
    ]);
    const r = out.get(`${baseUrl}/listing`);
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.result.markdown.length).toBeGreaterThan(0);
    }
  });

  it("processes an article job and extracts og:image", async () => {
    const out = await runWebCrawl([
      {
        kind: "detail",
        sourceName: "fixture",
        postUrl: `${baseUrl}/article`,
        url: `${baseUrl}/article`,
      },
    ]);
    const r = out.get(`${baseUrl}/article`);
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.result.imageUrl).toMatch(/^https?:\/\//);
      expect(r.result.markdown.length).toBeGreaterThanOrEqual(200);
    }
  });

  // -------------------------------------------------------------------------
  // Regression: a relative/malformed URL in the batch must NOT abort the crawl.
  //
  // Real Crawlee validates the whole addRequests batch atomically via
  // @sapphire/shapeshift — a single non-absolute URL throws "Received one or
  // more errors" and zeroes out every blog source. runWebCrawl drops invalid
  // URLs before they reach the crawler so the valid jobs still complete.
  // -------------------------------------------------------------------------
  it("drops a relative URL from a mixed batch without throwing, and still crawls the valid one", async () => {
    const valid = `${baseUrl}/article`;
    const out = await runWebCrawl([
      { kind: "detail", sourceName: "fixture", postUrl: "/blog/relative", url: "/blog/relative" },
      { kind: "detail", sourceName: "fixture", postUrl: valid, url: valid },
      { kind: "listing", sourceName: "fixture", url: "" },
    ]);

    // The valid job crawled successfully — the relative/empty siblings did not abort it.
    const good = out.get(valid);
    expect(good?.ok).toBe(true);

    // The invalid URLs are surfaced as failures, not silently missing.
    const relative = out.get("/blog/relative");
    expect(relative?.ok).toBe(false);
    if (relative && !relative.ok) expect(relative.error).toBe("invalid-url");
    const empty = out.get("");
    expect(empty?.ok).toBe(false);
    if (empty && !empty.ok) expect(empty.error).toBe("invalid-url");
  });

  it("returns invalid-url failures without throwing when every URL is non-crawlable", async () => {
    const out = await runWebCrawl([
      { kind: "detail", sourceName: "fixture", postUrl: "/a", url: "/a" },
      { kind: "listing", sourceName: "fixture", url: "mailto:hi@example.com" },
    ]);

    expect(out.get("/a")?.ok).toBe(false);
    expect(out.get("mailto:hi@example.com")?.ok).toBe(false);
  });

  it("does NOT create a ./storage/ directory", () => {
    expect(existsSync(join(process.cwd(), "storage"))).toBe(false);
    expect(existsSync(join(__dirname, "..", "..", "..", "storage"))).toBe(
      false,
    );
  });
});

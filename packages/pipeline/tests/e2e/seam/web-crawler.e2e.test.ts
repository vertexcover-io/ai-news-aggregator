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

  it("does NOT create a ./storage/ directory", () => {
    expect(existsSync(join(process.cwd(), "storage"))).toBe(false);
    expect(existsSync(join(__dirname, "..", "..", "..", "storage"))).toBe(
      false,
    );
  });
});

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { google } from "@ai-sdk/google";
import { rawItems } from "@newsletter/shared/db";
import { collectWeb, fetchMarkdown, extractPostFields } from "@pipeline/collectors/web.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";
import type { WebCollectConfig } from "@pipeline/types.js";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

const TEST_SOURCES = {
  anthropicResearch: {
    name: "anthropic-research",
    listingUrl: "https://www.anthropic.com/research",
  },
  openaiNews: {
    name: "openai-news",
    listingUrl: "https://openai.com/news",
  },
  huggingfaceBlog: {
    name: "huggingface-blog",
    listingUrl: "https://huggingface.co/blog",
  },
} as const;

const PINNED_POST_URL =
  "https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback";

const BROKEN_SOURCE = {
  name: "broken-source",
  listingUrl: "https://this-domain-does-not-exist.invalid/foo",
};

describe.skipIf(!process.env.GEMINI_API_KEY)("Web Collector E2E", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it(
    "collects from multiple blog sources and stores valid rows",
    async () => {
      const cfg: WebCollectConfig = {
        sources: [
          TEST_SOURCES.anthropicResearch,
          TEST_SOURCES.openaiNews,
          TEST_SOURCES.huggingfaceBlog,
        ],
        maxItems: 2,
      };

      const result = await collectWeb(
        { rawItemsRepo: createRawItemsRepo(db) },
        cfg,
      );

      expect(result.itemsStored).toBeGreaterThan(0);

      const rows = await db.select().from(rawItems);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.sourceType).toBe("blog");
        expect(row.title).toBeTruthy();
        expect(row.url).toBeTruthy();
        expect(row.content).toBeTruthy();
        expect(row.externalId).toBe(row.url);
        expect(row.engagement).toEqual({ points: 0, commentCount: 0 });
      }
    },
    60_000,
  );

  it(
    "fetches and extracts fields for a pinned historical post",
    async () => {
      const markdown = await fetchMarkdown(PINNED_POST_URL);
      expect(markdown.length).toBeGreaterThan(1000);

      const model = google("gemini-2.5-flash");
      const fields = await extractPostFields(PINNED_POST_URL, markdown, model);

      expect(fields.title.toLowerCase()).toContain("constitutional");
      const parsedDate = Date.parse(fields.published_at);
      expect(Number.isNaN(parsedDate)).toBe(false);
    },
    60_000,
  );

  it(
    "deduplicates, respects maxItems, and throws when all filtered by sinceDays",
    async () => {
      const repo = createRawItemsRepo(db);
      const baseCfg: WebCollectConfig = {
        sources: [TEST_SOURCES.anthropicResearch],
        maxItems: 1,
      };

      const resultA = await collectWeb({ rawItemsRepo: repo }, baseCfg);
      expect(resultA.itemsStored).toBe(1);

      const resultB = await collectWeb({ rawItemsRepo: repo }, baseCfg);
      expect(resultB.itemsStored).toBe(0);
      expect(resultB.failures).toBeUndefined();

      const sinceCfg: WebCollectConfig = {
        sources: [TEST_SOURCES.anthropicResearch],
        maxItems: 1,
        sinceDays: 0,
      };
      await expect(
        collectWeb({ rawItemsRepo: repo }, sinceCfg),
      ).rejects.toThrow(/all sources failed/);
    },
    60_000,
  );

  it(
    "surfaces partial failures while still storing from working sources",
    async () => {
      const cfg: WebCollectConfig = {
        sources: [TEST_SOURCES.anthropicResearch, BROKEN_SOURCE],
        maxItems: 2,
      };

      const result = await collectWeb(
        { rawItemsRepo: createRawItemsRepo(db) },
        cfg,
      );

      expect(result.failures).toBeDefined();
      const failures = result.failures ?? [];
      expect(failures.length).toBeGreaterThan(0);
      const brokenFailure = failures.find(
        (f) => f.source === BROKEN_SOURCE.name,
      );
      expect(brokenFailure).toBeDefined();
      expect(brokenFailure?.error).toBeTruthy();

      const rows = await db.select().from(rawItems);
      expect(rows.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "throws when all sources fail",
    async () => {
      const cfg: WebCollectConfig = {
        sources: [BROKEN_SOURCE],
        maxItems: 5,
      };

      await expect(
        collectWeb({ rawItemsRepo: createRawItemsRepo(db) }, cfg),
      ).rejects.toThrow(/all sources failed/);
    },
    60_000,
  );
});

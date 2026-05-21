import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import { collectWebSearch } from "@pipeline/collectors/web-search/index.js";
import { createWebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";
import type { RunSubmitWebSearchConfig } from "@newsletter/shared/types";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

const tavilyExternalIdPattern = /^tavily:[0-9a-f]{64}$/;

describe("Web-search collector seam E2E", () => {
  let db: AppDb;
  let createdExternalIds: readonly string[] = [];

  beforeAll(() => {
    db = getTestDb();
  });

  afterEach(async () => {
    if (createdExternalIds.length === 0) return;
    await db
      .delete(rawItems)
      .where(
        and(
          eq(rawItems.sourceType, "web_search"),
          inArray(rawItems.externalId, createdExternalIds),
        ),
      );
    createdExternalIds = [];
  });

  it.skipIf(!process.env.TAVILY_API_KEY)(
    "REQ-CO-2/REQ-CO-3: stores real Tavily results as web_search raw_items when TAVILY_API_KEY is present",
    async () => {
      const tavilyApiKey = process.env.TAVILY_API_KEY;
      if (!tavilyApiKey) {
        throw new Error("TAVILY_API_KEY unexpectedly missing in unskipped Tavily E2E test");
      }

      const collectorConfig: RunSubmitWebSearchConfig = {
        provider: "tavily",
        queries: [{ query: "AI", sinceDays: 7, maxItems: 3 }],
      };

      const result = await collectWebSearch(
        {
          rawItemsRepo: createRawItemsRepo(db),
          provider: createWebSearchProvider("tavily", { tavilyApiKey }),
        },
        collectorConfig,
      );

      expect(result.itemsFetched).toBeGreaterThan(0);
      expect(result.itemsStored).toBeGreaterThan(0);

      const rows = await db
        .select()
        .from(rawItems)
        .where(
          and(
            eq(rawItems.sourceType, "web_search"),
            sql`${rawItems.metadata}->>'provider' = 'tavily'`,
            sql`${rawItems.metadata}->>'query' = 'AI'`,
          ),
        );
      const tavilyRows = rows.filter((row) =>
        tavilyExternalIdPattern.test(row.externalId),
      );
      createdExternalIds = tavilyRows.map((row) => row.externalId);

      expect(tavilyRows.length).toBeGreaterThan(0);
      for (const row of tavilyRows) {
        expect(row.sourceType).toBe("web_search");
        expect(row.externalId).toMatch(tavilyExternalIdPattern);
        expect(row.title).toBeTruthy();
        expect(row.url).toBeTruthy();
        expect(row.metadata).toEqual(
          expect.objectContaining({ provider: "tavily", query: "AI" }),
        );
      }
    },
  );
});

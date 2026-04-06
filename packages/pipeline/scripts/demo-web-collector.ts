/**
 * Demo script to test the web collectors against real URLs.
 *
 * Usage:
 *   cd packages/pipeline
 *   npx tsx scripts/demo-web-collector.ts          # manual selectors (web-collect)
 *   npx tsx scripts/demo-web-collector.ts auto      # auto selectors via mock LLM (web-auto-collect)
 *
 * No DB needed — items are printed to console instead of stored.
 * Edit the SOURCES / AUTO_SOURCES arrays below to test different sites.
 */

import { collectWeb } from "../src/collectors/web.js";
import { collectWebAuto } from "../src/collectors/web-auto.js";
import type { WebSourceConfig, WebAutoSourceConfig, WebSourceSelectors } from "../src/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { GeminiClient } from "../src/collectors/web-selectors.js";
import type { SelectorCache } from "../src/collectors/selector-cache.js";

// --- Manual selectors (web-collect) ---
const SOURCES: WebSourceConfig[] = [
  {
    name: "anthropic-blog",
    sourceType: "blog",
    indexUrl: "https://www.anthropic.com/research",
    selectors: {
      articleLink: 'a[href*="/research/"]',
      title: "h1",
      content: "article",
      author: '[rel="author"]',
      date: "time",
    },
    maxItems: 3,
  },
];

// --- Auto selectors (web-auto-collect) ---
const AUTO_SOURCES: WebAutoSourceConfig[] = [
  {
    name: "anthropic-blog-auto",
    sourceType: "blog",
    indexUrl: "https://www.anthropic.com/research",
    maxItems: 3,
  },
];

// Fake repo that prints items instead of storing them
const printRepo = {
  upsertItems: (items: RawItemInsert[]): Promise<void> => {
    for (const item of items) {
      console.log("\n" + "=".repeat(80));
      console.log(`Title:      ${item.title}`);
      console.log(`URL:        ${item.url}`);
      console.log(`ExternalId: ${item.externalId}`);
      console.log(`SourceType: ${item.sourceType}`);
      console.log(`Author:     ${item.author ?? "(none)"}`);
      console.log(`Date:       ${item.publishedAt?.toISOString() ?? "(none)"}`);
      console.log(`Content:    ${(item.content ?? "").slice(0, 300)}...`);
    }
    return Promise.resolve();
  },
};

// Mock geminiClient that returns plausible selectors without calling a real API
const mockGeminiClient: GeminiClient = {
  generateContent(prompt: string): Promise<{ text: string | undefined }> {
    console.log("[mock-gemini] Received prompt, returning mock selectors...");
    if (prompt.includes("index")) {
      return Promise.resolve({
        text: JSON.stringify({
          articleLink: 'a[href*="/research/"]',
        }),
      });
    }
    return Promise.resolve({
      text: JSON.stringify({
        title: "h1",
        content: "article",
        author: '[rel="author"]',
        date: "time",
      }),
    });
  },
};

// In-memory selector cache (no file I/O)
function createInMemoryCache(): SelectorCache {
  const entries = new Map<string, WebSourceSelectors>();
  return {
    get(url: string) {
      return entries.get(url) ?? null;
    },
    set(url: string, selectors: WebSourceSelectors) {
      entries.set(url, selectors);
    },
    invalidate(url: string) {
      entries.delete(url);
    },
    save() {
      // no-op for in-memory
    },
  };
}

const mode = process.argv[2];

if (mode === "auto") {
  console.log(`Testing web-auto-collect with ${AUTO_SOURCES.length} source(s) (mock LLM)...\n`);

  const result = await collectWebAuto(
    {
      rawItemsRepo: printRepo,
      geminiClient: mockGeminiClient,
      selectorCache: createInMemoryCache(),
    },
    { sources: AUTO_SOURCES },
  );

  console.log("\n" + "=".repeat(80));
  console.log("\nResult:", JSON.stringify(result, null, 2));
} else {
  console.log(`Testing web-collect with ${SOURCES.length} source(s) (manual selectors)...\n`);

  const result = await collectWeb({ rawItemsRepo: printRepo }, { sources: SOURCES });

  console.log("\n" + "=".repeat(80));
  console.log("\nResult:", JSON.stringify(result, null, 2));
}

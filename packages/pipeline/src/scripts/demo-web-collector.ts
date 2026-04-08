/**
 * Demo script for the web collector.
 *
 * Runs `collectWeb` against one or more blog listing URLs using an in-memory
 * raw-items repo (no database required). Useful for manually checking what the
 * discovery LLM picks and what the detail extraction returns.
 *
 * Usage:
 *   pnpm --filter @newsletter/pipeline exec tsx src/scripts/demo-web-collector.ts
 *   pnpm --filter @newsletter/pipeline exec tsx src/scripts/demo-web-collector.ts \
 *     --source "Anthropic Research=https://www.anthropic.com/research" \
 *     --max 3 \
 *     --since 30
 *
 * Requires in .env:
 *   GOOGLE_GENERATIVE_AI_API_KEY  - Gemini API key
 *   JINA_API_KEY                  - optional, raises Jina rate limits
 */

import "dotenv/config";
import { google } from "@ai-sdk/google";
import type { RawItemInsert, SourceType } from "@newsletter/shared/db";
import { collectWeb } from "@pipeline/collectors/web.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { BlogSource } from "@pipeline/types.js";

interface CliArgs {
  sources: BlogSource[];
  maxItems: number;
  sinceDays: number | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const sources: BlogSource[] = [];
  let maxItems = 3;
  let sinceDays: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--source" && next) {
      const eq = next.indexOf("=");
      if (eq === -1) {
        throw new Error(`--source must be "Name=URL", got: ${next}`);
      }
      sources.push({ name: next.slice(0, eq), listingUrl: next.slice(eq + 1) });
      i++;
    } else if (arg === "--max" && next) {
      maxItems = Number.parseInt(next, 10);
      i++;
    } else if (arg === "--since" && next) {
      sinceDays = Number.parseInt(next, 10);
      i++;
    }
  }

  if (sources.length === 0) {
    sources.push({
      name: "Anthropic Research",
      listingUrl: "https://www.anthropic.com/research",
    });
  }

  return { sources, maxItems, sinceDays };
}

interface DemoRepo extends RawItemsRepo {
  collected: RawItemInsert[];
}

function createInMemoryRawItemsRepo(): DemoRepo {
  const collected: RawItemInsert[] = [];
  return {
    collected,
    upsertItems(items: RawItemInsert[]): Promise<void> {
      collected.push(...items);
      return Promise.resolve();
    },
    findExistingExternalIds(
      _sourceType: SourceType,
      _externalIds: string[],
    ): Promise<Set<string>> {
      return Promise.resolve(new Set());
    },
  };
}

function printItem(item: RawItemInsert, index: number): void {
  console.log(`\n  [${index + 1}] ${item.title}`);
  console.log(`      url:          ${item.url}`);
  console.log(`      author:       ${item.author ?? "(none)"}`);
  console.log(
    `      published_at: ${item.publishedAt ? item.publishedAt.toISOString() : "(none)"}`,
  );
  const content = item.content ?? "";
  const preview = content.replace(/\s+/g, " ").slice(0, 140);
  const ellipsis = content.length > 140 ? "…" : "";
  console.log(`      preview:      ${preview}${ellipsis}`);
}

async function main(): Promise<void> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("ERROR: GOOGLE_GENERATIVE_AI_API_KEY is not set in .env");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const repo = createInMemoryRawItemsRepo();
  const llmModel = google("gemini-2.5-flash");

  console.log("Web collector demo");
  console.log("  model:     gemini-2.5-flash");
  console.log(`  maxItems:  ${args.maxItems}`);
  console.log(`  sinceDays: ${args.sinceDays ?? "(no filter)"}`);
  console.log("  sources:");
  for (const source of args.sources) {
    console.log(`    - ${source.name}: ${source.listingUrl}`);
  }

  const started = Date.now();
  const result = await collectWeb(
    { rawItemsRepo: repo, llmModel },
    {
      sources: args.sources,
      maxItems: args.maxItems,
      sinceDays: args.sinceDays,
    },
  );
  const elapsed = Date.now() - started;

  console.log(`\nCompleted in ${elapsed}ms`);
  console.log(`  itemsFetched: ${result.itemsFetched}`);
  console.log(`  itemsStored:  ${result.itemsStored}`);
  console.log(`  failures:     ${result.failures?.length ?? 0}`);

  if (result.failures && result.failures.length > 0) {
    console.log("\nFailures:");
    for (const f of result.failures) {
      const locator = f.postUrl ? ` (${f.postUrl})` : "";
      console.log(`  - ${f.source}${locator}: ${f.error}`);
    }
  }

  if (repo.collected.length > 0) {
    console.log("\nCollected items:");
    repo.collected.forEach((item, i) => {
      printItem(item, i);
    });
  } else {
    console.log("\nNo items collected.");
  }
}

main().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});

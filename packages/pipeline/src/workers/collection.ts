import { Worker } from "bullmq";
import { getDb, createRedisConnection } from "@newsletter/shared/db";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import { collectWebAuto } from "@pipeline/collectors/web-auto.js";
import { createGeminiClient } from "@pipeline/collectors/web-selectors.js";
import { createSelectorCache } from "@pipeline/collectors/selector-cache.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig, RedditCollectConfig, WebCollectConfig, WebAutoCollectConfig } from "@pipeline/types.js";

export interface CollectionJobLike {
  name: string;
  data: { config: HnCollectConfig | RedditCollectConfig | WebCollectConfig | WebAutoCollectConfig };
}

export async function handleCollectionJob(job: CollectionJobLike): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectHn({ rawItemsRepo }, job.data.config as HnCollectConfig);
    }
    case "reddit-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectReddit({ rawItemsRepo }, job.data.config as RedditCollectConfig);
    }
    case "web-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectWeb({ rawItemsRepo }, job.data.config as WebCollectConfig);
    }
    case "web-auto-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? "");
      const selectorCache = createSelectorCache(process.env.SELECTOR_CACHE_PATH ?? ".selector-cache.json");
      return collectWebAuto({ rawItemsRepo, geminiClient, selectorCache }, job.data.config as WebAutoCollectConfig);
    }
    default:
      throw new Error(`Unknown collector: ${job.name}`);
  }
}

export const collectionWorker = new Worker(
  "collection",
  handleCollectionJob,
  {
    connection: createRedisConnection(),
    stalledInterval: 30000,
    maxStalledCount: 2,
  },
);

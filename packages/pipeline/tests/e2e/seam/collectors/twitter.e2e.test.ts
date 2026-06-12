import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import { collectTwitter } from "@pipeline/collectors/twitter/index.js";
import {
  createRettiwtClient,
  type RettiwtFacade,
  type RettiwtRawTweet,
} from "@pipeline/collectors/twitter/clients/rettiwt.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";
import type { TwitterCollectConfig } from "@pipeline/types.js";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

const ORIGINAL_RETTIWT_API_KEY = process.env.RETTIWT_API_KEY;
const NOW = new Date("2026-05-21T12:00:00.000Z");

const tweetFixture: readonly RettiwtRawTweet[] = [
  {
    id: "phase-3-twitter-1",
    fullText: "AI labs publish a new eval harness for agent reliability",
    createdAt: "2026-05-21T11:00:00.000Z",
    tweetBy: { userName: "researcher" },
    likeCount: 42,
    retweetCount: 7,
    replyCount: 3,
    quoteCount: 1,
    entities: { urls: ["https://example.com/ai-eval"] },
  },
  {
    id: "phase-3-twitter-2",
    fullText: "Open model maintainers ship a compact reasoning checkpoint",
    createdAt: "2026-05-21T10:30:00.000Z",
    tweetBy: { userName: "models" },
    likeCount: 31,
    retweetCount: 5,
    replyCount: 2,
    quoteCount: 0,
  },
  {
    id: "phase-3-twitter-3",
    fullText: "Enterprise AI teams standardize red-team reporting",
    createdAt: "2026-05-21T10:00:00.000Z",
    tweetBy: { userName: "ops" },
    likeCount: 18,
    retweetCount: 2,
    replyCount: 1,
    quoteCount: 0,
  },
];

const tweetExternalIds = tweetFixture.map((tweet) => tweet.id);

async function deleteTwitterRows(db: AppDb): Promise<void> {
  await db
    .delete(rawItems)
    .where(
      and(
        eq(rawItems.sourceType, "twitter"),
        inArray(rawItems.externalId, tweetExternalIds),
      ),
    );
}

function createFixtureRettiwtFacade(): RettiwtFacade {
  return {
    list: {
      tweets: (id, count, cursor) => {
        expect(id).toBe("phase-3-list");
        expect(count).toBe(3);
        expect(cursor).toBeUndefined();
        return Promise.resolve({ list: [...tweetFixture], next: null });
      },
    },
    user: {
      timeline: () => Promise.reject(new Error("unexpected user timeline fetch")),
    },
  };
}

describe("Twitter collector seam E2E", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    process.env.RETTIWT_API_KEY = "phase-3-fake-rettiwt-key";
    await deleteTwitterRows(db);
  });

  afterEach(async () => {
    await deleteTwitterRows(db);
    if (ORIGINAL_RETTIWT_API_KEY === undefined) {
      delete process.env.RETTIWT_API_KEY;
    } else {
      process.env.RETTIWT_API_KEY = ORIGINAL_RETTIWT_API_KEY;
    }
  });

  it("REQ-CO-1: stores three rettiwt timeline tweets as twitter raw_items", async () => {
    const collectorConfig: TwitterCollectConfig = {
      listIds: ["phase-3-list"],
      users: [],
      maxTweetsPerSource: 3,
      sinceHours: 24,
    };

    const result = await collectTwitter(
      {
        client: createRettiwtClient({ rettiwt: createFixtureRettiwtFacade() }),
        rawItemsRepo: createRawItemsRepo(db, TENANT_ZERO_ID),
        sleep: () => Promise.resolve(),
        now: () => NOW,
      },
      collectorConfig,
    );

    expect(result.itemsFetched).toBe(3);
    expect(result.itemsStored).toBe(3);
    expect(result.unitResults).toEqual([
      expect.objectContaining({
        identifier: "list:phase-3-list",
        itemsFetched: 3,
        status: "completed",
      }),
    ]);

    const rows = await db
      .select()
      .from(rawItems)
      .where(
        and(
          eq(rawItems.sourceType, "twitter"),
          inArray(rawItems.externalId, tweetExternalIds),
        ),
      );

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.externalId).sort()).toEqual([
      "phase-3-twitter-1",
      "phase-3-twitter-2",
      "phase-3-twitter-3",
    ]);
    for (const row of rows) {
      expect(row.sourceType).toBe("twitter");
      expect(row.title).toBeTruthy();
      expect(row.url).toBeTruthy();
      expect(row.metadata).toHaveProperty("comments");
    }
  });
});

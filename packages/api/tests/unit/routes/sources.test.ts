import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { createPublicSourcesRouter } from "@api/routes/sources.js";
import type {
  RawItemsRepo,
  RawItemsAggregateRow,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

function makeRawItemsRepo(agg: RawItemsAggregateRow[]): RawItemsRepo {
  return {
    findByIds: () => Promise.resolve([]),
    listForRun: () => Promise.resolve([]),
    aggregateBySourceAndIdentifier: () => Promise.resolve(agg),
  };
}

function makeRunArchivesRepo(): RunArchivesRepo {
  return {
    findById: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    listReviewed: () => Promise.resolve([]),
    searchReviewed: () => Promise.resolve({ archives: [], total: 0 }),
    findMostRecentReviewed: () => Promise.resolve(null),
    updateRankedItems: () => {
      throw new Error("n/a");
    },
    findPoolItems: () => Promise.resolve({ items: [], total: 0 }),
    markSlackNotified: () => Promise.resolve(),
    markEmailSent: () => Promise.resolve(),
    markNotification: () => Promise.resolve(),
    markLinkedInPosted: () => Promise.resolve(),
    markTwitterPosted: () => Promise.resolve(),
    recordSocialFailure: () => Promise.resolve(),
    delete: () => Promise.resolve({ deleted: false, removedEmailSends: 0 }),
    getReviewedDigestCountsByDerivedSource: () => Promise.resolve(new Map()),
    getRecentSourceTelemetry: () => Promise.resolve(new Map()),
  };
}

function makeSettingsRepo(rankingPrompt: string): UserSettingsRepo {
  return {
    get: () =>
      Promise.resolve({ rankingPrompt } as unknown as UserSettings),
    upsert: () => {
      throw new Error("n/a");
    },
  };
}

describe("GET /api/sources/summary", () => {
  function buildAppWith(agg: RawItemsAggregateRow[]): Hono {
    const router = createPublicSourcesRouter({
      getRawItemsRepo: () => makeRawItemsRepo(agg),
      getArchiveRepo: () => makeRunArchivesRepo(),
      getSettingsRepo: () => makeSettingsRepo("the prompt"),
    });
    const app = new Hono();
    app.route("/api/sources", router);
    return app;
  }

  it("returns 200 with response shape matching REQ-012", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "hn",
        identifier: "news.ycombinator.com",
        url: "https://news.ycombinator.com/item?id=1",
        todayCount: 3,
        weekCount: 8,
        lastCollectedAt: new Date("2026-05-23T10:00:00.000Z"),
      },
    ];
    const app = buildAppWith(agg);
    const res = await app.request("/api/sources/summary");
    expect(res.status).toBe(200);
    interface ResponseRow {
      identifier: string;
      displayName: string;
      url: string | null;
      todayCount: number;
      weekCount: number;
      inDigestCount: number;
      status: string;
      lastFetchedAt: string | null;
    }
    interface ResponseSection {
      sourceType: string;
      rows: ResponseRow[];
    }
    const body = (await res.json()) as {
      generatedAt: string;
      sections: ResponseSection[];
      rankingPrompt: string;
    };
    expect(typeof body.generatedAt).toBe("string");
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].sourceType).toBe("hn");
    expect(body.sections[0].rows[0]).toEqual({
      identifier: "news.ycombinator.com",
      displayName: "news.ycombinator.com",
      url: "https://news.ycombinator.com/item?id=1",
      todayCount: 3,
      weekCount: 8,
      inDigestCount: 0,
      status: expect.any(String),
      lastFetchedAt: "2026-05-23T10:00:00.000Z",
    });
    expect(body.rankingPrompt).toBe("the prompt");
  });

  it("returns empty sections array when no data", async () => {
    const app = buildAppWith([]);
    const res = await app.request("/api/sources/summary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: unknown[] };
    expect(body.sections).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { setTestTenant } from "../../helpers/tenant.js";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { createPublicSourcesRouter } from "@api/routes/sources.js";
import type {
  RawItemsRepo,
  RawItemsAggregateRow,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { SourceRecord, SourcesRepo } from "@api/repositories/sources.js";

const NOW = new Date("2026-05-23T12:00:00.000Z");

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
    getSourceFailuresInRange: () => Promise.resolve([]),
    countCompletedRunsInRange: () => Promise.resolve(0),
  };
}

function makeSettingsRepo(): UserSettingsRepo {
  return {
    get: () =>
      Promise.resolve({
        id: "settings",
        topN: 12,
        halfLifeHours: 24,
        hnEnabled: true,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
        webSearchEnabled: false,
        webSearchConfig: null,
        posthogEnabled: false,
        posthogProjectToken: null,
        posthogHost: null,
        scheduleTime: "07:00",
        pipelineTime: "07:00",
        emailTime: "07:30",
        linkedinTime: "07:45",
        twitterTime: "08:00",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
        emailEnabled: true,
        linkedinEnabled: true,
        twitterPostEnabled: true,
        autoReview: false,
        rankingPrompt: "the prompt",
        updatedAt: NOW.toISOString(),
      } as UserSettings),
    upsert: () => {
      throw new Error("n/a");
    },
  };
}

function makeSourcesRepo(): Pick<SourcesRepo, "listEnabled"> {
  return {
    listEnabled: () =>
      Promise.resolve([
        {
          id: "00000000-0000-0000-0000-000000000001",
          type: "hn",
          config: { sinceDays: 1 },
          enabled: true,
          health: null,
          createdAt: NOW,
          updatedAt: NOW,
        } as SourceRecord,
      ]),
  };
}

function buildApp(agg: RawItemsAggregateRow[]): Hono {
  const router = createPublicSourcesRouter({
    getRawItemsRepo: () => makeRawItemsRepo(agg),
    getArchiveRepo: () => makeRunArchivesRepo(),
    getSettingsRepo: () => makeSettingsRepo(),
    getSourcesRepo: () => makeSourcesRepo(),
    now: () => NOW,
  });
  const app = new Hono();
  app.use("*", setTestTenant());
  app.route("/api/sources", router);
  return app;
}

describe("GET /api/sources/summary", () => {
  it("returns 200 with response shape including range, configured, failures", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "hn",
        identifier: "news.ycombinator.com",
        url: "https://news.ycombinator.com/item?id=1",
        fetchedCount: 8,
        lastCollectedAt: new Date("2026-05-23T10:00:00.000Z"),
      },
    ];
    const app = buildApp(agg);
    const res = await app.request("/api/sources/summary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generatedAt: string;
      range: { from: string; to: string; runsInRange: number };
      sections: { sourceType: string; rows: unknown[] }[];
      configured: { sourceType: string; rows: unknown[] }[];
      failures: unknown[];
      rankingPrompt: string;
    };
    expect(body.range.runsInRange).toBe(0);
    expect(typeof body.range.from).toBe("string");
    expect(typeof body.range.to).toBe("string");
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].sourceType).toBe("hn");
    expect(body.configured.map((s) => s.sourceType)).toContain("hn");
    expect(body.failures).toEqual([]);
    expect(body.rankingPrompt).toBe("the prompt");
  });

  it("defaults to a 7-day window when no params provided", async () => {
    const app = buildApp([]);
    const res = await app.request("/api/sources/summary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      range: { from: string; to: string };
    };
    const from = new Date(body.range.from).getTime();
    const to = new Date(body.range.to).getTime();
    expect(to - from).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -2);
    expect(body.range.to).toBe(NOW.toISOString());
  });

  it("honours explicit from/to query params", async () => {
    const app = buildApp([]);
    const res = await app.request(
      "/api/sources/summary?from=2026-05-01T00:00:00Z&to=2026-05-10T00:00:00Z",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      range: { from: string; to: string };
    };
    expect(body.range.from).toBe("2026-05-01T00:00:00.000Z");
    expect(body.range.to).toBe("2026-05-10T00:00:00.000Z");
  });

  it("400s when from >= to", async () => {
    const app = buildApp([]);
    const res = await app.request(
      "/api/sources/summary?from=2026-05-10T00:00:00Z&to=2026-05-01T00:00:00Z",
    );
    expect(res.status).toBe(400);
  });

  it("400s on invalid date", async () => {
    const app = buildApp([]);
    const res = await app.request("/api/sources/summary?from=not-a-date");
    expect(res.status).toBe(400);
  });

  it("clamps to in the future down to now", async () => {
    const app = buildApp([]);
    const future = "2099-01-01T00:00:00.000Z";
    const res = await app.request(`/api/sources/summary?to=${future}`);
    const body = (await res.json()) as {
      range: { to: string };
    };
    expect(body.range.to).toBe(NOW.toISOString());
  });
});

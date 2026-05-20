import { describe, it, expect } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";

interface StoredRow {
  id: string;
  singleton: boolean;
  topN: number;
  halfLifeHours: number | null;
  hnEnabled: boolean;
  hnConfig: unknown;
  redditEnabled: boolean;
  redditConfig: unknown;
  webEnabled: boolean;
  webConfig: unknown;
  webSearchEnabled: boolean;
  webSearchConfig: unknown;
  twitterEnabled: boolean;
  twitterConfig: unknown;
  posthogEnabled: boolean;
  posthogProjectToken: string | null;
  posthogHost: string | null;
  pipelineTime: string;
  emailTime: string;
  linkedinTime: string;
  twitterTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
  emailEnabled: boolean;
  linkedinEnabled: boolean;
  twitterPostEnabled: boolean;
  autoReview: boolean;
  updatedAt: Date;
}

function makeFakeDb(): { db: Pick<AppDb, "select" | "insert">; rows: StoredRow[] } {
  const rows: StoredRow[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (_n: number) => Promise.resolve(rows),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Partial<StoredRow>) => ({
        onConflictDoUpdate: ({ set }: { set: Partial<StoredRow> }) => ({
          returning: () => {
            if (rows.length === 0) {
              const row: StoredRow = {
                id: "00000000-0000-0000-0000-000000000001",
                singleton: true,
                topN: v.topN ?? 0,
                halfLifeHours: v.halfLifeHours ?? null,
                hnEnabled: v.hnEnabled ?? false,
                hnConfig: v.hnConfig ?? null,
                redditEnabled: v.redditEnabled ?? false,
                redditConfig: v.redditConfig ?? null,
                webEnabled: v.webEnabled ?? false,
                webConfig: v.webConfig ?? null,
                webSearchEnabled: v.webSearchEnabled ?? false,
                webSearchConfig: v.webSearchConfig ?? null,
                twitterEnabled: v.twitterEnabled ?? false,
                twitterConfig: v.twitterConfig ?? null,
                posthogEnabled: v.posthogEnabled ?? false,
                posthogProjectToken: v.posthogProjectToken ?? null,
                posthogHost: v.posthogHost ?? null,
                pipelineTime: v.pipelineTime ?? "00:00",
                emailTime: v.emailTime ?? "00:30",
                linkedinTime: v.linkedinTime ?? "00:30",
                twitterTime: v.twitterTime ?? "00:30",
                scheduleTimezone: v.scheduleTimezone ?? "UTC",
                scheduleEnabled: v.scheduleEnabled ?? false,
                emailEnabled: v.emailEnabled ?? true,
                linkedinEnabled: v.linkedinEnabled ?? true,
                twitterPostEnabled: v.twitterPostEnabled ?? true,
                autoReview: v.autoReview ?? false,
                updatedAt: v.updatedAt ?? new Date(),
              };
              rows.push(row);
              return Promise.resolve([row]);
            }
            const existing = rows[0];
            Object.assign(existing, set);
            return Promise.resolve([existing]);
          },
        }),
      }),
    }),
  } as unknown as Pick<AppDb, "select" | "insert">;

  return { db, rows };
}

const baseInput = {
  topN: 10,
  halfLifeHours: null,
  hnEnabled: true,
  hnConfig: { sinceDays: 1 },
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  webSearchEnabled: false,
  webSearchConfig: null as null | { provider: "tavily"; queries: { query: string; sinceDays: number; maxItems: number }[] },
  twitterEnabled: false,
  twitterConfig: null,
  posthogEnabled: false,
  posthogProjectToken: null,
  posthogHost: null,
  scheduleTime: "09:30",
  pipelineTime: "09:30",
  emailTime: "10:00",
  linkedinTime: "10:15",
  twitterTime: "10:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
};

describe("UserSettingsRepo", () => {
  it("get() returns null when no row exists", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    const result = await repo.get();
    expect(result).toBeNull();
  });

  it("upsert() persists row; get() returns the persisted value", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    const saved = await repo.upsert(baseInput);
    expect(saved.topN).toBe(10);
    expect(saved.scheduleTime).toBe("09:30");
    const got = await repo.get();
    expect(got?.topN).toBe(10);
  });

  it("REQ-020/REQ-021: upsert() round-trips twitterConfig through get()", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    const twitterConfig = {
      listIds: ["1585430245762441216"],
      users: [{ handle: "jack", userId: "12" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    };
    const saved = await repo.upsert({ ...baseInput, twitterConfig });
    expect(saved.twitterConfig).toEqual(twitterConfig);
    const got = await repo.get();
    expect(got?.twitterConfig).toEqual(twitterConfig);
  });

  it("upsert() round-trips PostHog config through get()", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    const saved = await repo.upsert({
      ...baseInput,
      posthogEnabled: true,
      posthogProjectToken: "phc_project_token",
      posthogHost: "https://us.i.posthog.com",
    });
    expect(saved.posthogEnabled).toBe(true);
    expect(saved.posthogProjectToken).toBe("phc_project_token");
    expect(saved.posthogHost).toBe("https://us.i.posthog.com");
    const got = await repo.get();
    expect(got?.posthogProjectToken).toBe("phc_project_token");
  });

  it("upsert() round-trips webSearchConfig through get()", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    const webSearchConfig = {
      provider: "tavily" as const,
      queries: [
        { query: "ai agents", sinceDays: 7, maxItems: 5 },
        { query: "llm benchmarks", sinceDays: 14, maxItems: 10 },
      ],
    };
    const saved = await repo.upsert({
      ...baseInput,
      webSearchEnabled: true,
      webSearchConfig,
    });
    expect(saved.webSearchEnabled).toBe(true);
    expect(saved.webSearchConfig).toEqual(webSearchConfig);
    const got = await repo.get();
    expect(got?.webSearchEnabled).toBe(true);
    expect(got?.webSearchConfig).toEqual(webSearchConfig);
  });

  it("upsert() persists webSearchEnabled=false + null config", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    const saved = await repo.upsert({
      ...baseInput,
      webSearchEnabled: false,
      webSearchConfig: null,
    });
    expect(saved.webSearchEnabled).toBe(false);
    expect(saved.webSearchConfig).toBeNull();
    const got = await repo.get();
    expect(got?.webSearchEnabled).toBe(false);
    expect(got?.webSearchConfig).toBeNull();
  });

  it("upsert() twice keeps exactly one row (singleton)", async () => {
    const { db, rows } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    await repo.upsert(baseInput);
    await repo.upsert({
      ...baseInput,
      topN: 25,
      scheduleTime: "07:00",
      pipelineTime: "07:00",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].topN).toBe(25);
    expect(rows[0].pipelineTime).toBe("07:00");
  });
});

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
  twitterEnabled: boolean;
  twitterConfig: unknown;
  webSearchEnabled: boolean;
  webSearchConfig: unknown;
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
  rankingPrompt: string;
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
                twitterEnabled: v.twitterEnabled ?? false,
                twitterConfig: v.twitterConfig ?? null,
                webSearchEnabled: v.webSearchEnabled ?? false,
                webSearchConfig: v.webSearchConfig ?? null,
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
                rankingPrompt: v.rankingPrompt ?? "",
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
  twitterEnabled: false,
  twitterConfig: null,
  webSearchEnabled: false,
  webSearchConfig: null,
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
  rankingPrompt: "Default ranking prompt",
};

describe("UserSettingsRepo", () => {
  it("get() returns null when no row exists", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db, "00000000-0000-0000-0000-000000000000");
    const result = await repo.get();
    expect(result).toBeNull();
  });

  it("upsert() persists row; get() returns the persisted value", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db, "00000000-0000-0000-0000-000000000000");
    const saved = await repo.upsert(baseInput);
    expect(saved.topN).toBe(10);
    expect(saved.scheduleTime).toBe("09:30");
    const got = await repo.get();
    expect(got?.topN).toBe(10);
  });

  // Field round-trip tests (twitterConfig / PostHog / webSearchConfig /
  // multi-line rankingPrompt) were removed: the fake db here just Object.assigns
  // the input back, so they tested the fake rather than the repo's column
  // mapping. Real round-trips through Postgres are covered by settings.e2e.test.ts.

  it("upsert() twice keeps exactly one row (singleton)", async () => {
    const { db, rows } = makeFakeDb();
    const repo = createUserSettingsRepo(db, "00000000-0000-0000-0000-000000000000");
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

  it("PHASE2-C2: upsert() twice updates rankingPrompt", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db, "00000000-0000-0000-0000-000000000000");
    await repo.upsert({ ...baseInput, rankingPrompt: "First prompt" });
    await repo.upsert({ ...baseInput, rankingPrompt: "Second prompt\nwith newline" });
    const got = await repo.get();
    expect(got?.rankingPrompt).toBe("Second prompt\nwith newline");
  });

  it("REQ-005: second upsert overwrites prior webSearchConfig queries", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db, "00000000-0000-0000-0000-000000000000");
    const configA = {
      provider: "tavily" as const,
      queries: [{ query: "query A", sinceDays: 7, maxItems: 5 }],
    };
    const configB = {
      provider: "tavily" as const,
      queries: [{ query: "query B", sinceDays: 14, maxItems: 10 }],
    };
    await repo.upsert({ ...baseInput, webSearchEnabled: true, webSearchConfig: configA });
    await repo.upsert({ ...baseInput, webSearchEnabled: true, webSearchConfig: configB });
    const got = await repo.get();
    expect(got?.webSearchConfig).toEqual(configB);
  });
});

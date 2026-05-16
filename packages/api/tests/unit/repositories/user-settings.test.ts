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
  scheduleTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
  rankingWorkflow: string;
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
                scheduleTime: v.scheduleTime ?? "00:00",
                scheduleTimezone: v.scheduleTimezone ?? "UTC",
                scheduleEnabled: v.scheduleEnabled ?? false,
                rankingWorkflow: v.rankingWorkflow ?? "",
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
  scheduleTime: "09:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
  rankingWorkflow: "",
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

  it("upsert() twice keeps exactly one row (singleton)", async () => {
    const { db, rows } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    await repo.upsert(baseInput);
    await repo.upsert({ ...baseInput, topN: 25, scheduleTime: "07:00" });
    expect(rows).toHaveLength(1);
    expect(rows[0].topN).toBe(25);
    expect(rows[0].scheduleTime).toBe("07:00");
  });

  it("get() resolves an empty stored ranking_workflow to the default workflow", async () => {
    const { db, rows } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    await repo.upsert({ ...baseInput, rankingWorkflow: "" });
    expect(rows[0].rankingWorkflow).toBe("");
    const got = await repo.get();
    expect(got?.rankingWorkflow.length).toBeGreaterThan(0);
    expect(got?.rankingWorkflow).not.toBe("");
  });

  it("get() returns a custom ranking_workflow verbatim (after trim)", async () => {
    const { db } = makeFakeDb();
    const repo = createUserSettingsRepo(db);
    await repo.upsert({ ...baseInput, rankingWorkflow: "boost agent stuff" });
    const got = await repo.get();
    expect(got?.rankingWorkflow).toBe("boost agent stuff");
  });
});

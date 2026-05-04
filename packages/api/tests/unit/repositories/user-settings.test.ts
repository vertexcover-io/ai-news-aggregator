import { describe, it, expect } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";

interface StoredRow {
  id: string;
  singleton: boolean;
  topN: number;
  halfLifeHours: number | null;
  hnConfig: unknown;
  redditConfig: unknown;
  webConfig: unknown;
  twitterConfig: unknown;
  scheduleTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
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
                hnConfig: v.hnConfig ?? null,
                redditConfig: v.redditConfig ?? null,
                webConfig: v.webConfig ?? null,
                twitterConfig: v.twitterConfig ?? null,
                scheduleTime: v.scheduleTime ?? "00:00",
                scheduleTimezone: v.scheduleTimezone ?? "UTC",
                scheduleEnabled: v.scheduleEnabled ?? false,
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
  hnConfig: { sinceDays: 1 },
  redditConfig: null,
  webConfig: null,
  twitterConfig: null,
  scheduleTime: "09:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
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
});

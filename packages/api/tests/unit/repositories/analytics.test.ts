import { describe, it, expect } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import { createAnalyticsRepo } from "@api/repositories/analytics.js";

type CountResult = { value: number }[];

/**
 * Build a fake DB that returns pre-configured counts in the order that
 * getMetrics issues queries:
 *   [0] totalSubscriptions
 *   [1] totalUnsubscriptions
 *   [2] emailsSent
 *   [3] bounces
 *   [4] complaints
 *   [5] opens
 *   [6] clicks
 *
 * All 7 queries run via Promise.all, so the order matches the array index.
 */
function makeFakeDb(counts: [number, number, number, number, number, number, number]): Pick<AppDb, "select"> {
  let callIndex = 0;

  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const value = counts[callIndex++] ?? 0;
          return Promise.resolve([{ value }] as CountResult);
        },
      }),
    }),
  } as unknown as Pick<AppDb, "select">;

  return db;
}

const from = new Date("2026-01-01");
const to = new Date("2026-02-01");

describe("AnalyticsRepo.getMetrics — empty DB", () => {
  it("REQ-AR01: returns 0 for all counts when DB is empty", async () => {
    const db = makeFakeDb([0, 0, 0, 0, 0, 0, 0]);
    const repo = createAnalyticsRepo(db);
    const result = await repo.getMetrics({ from, to });
    expect(result.totalSubscriptions).toBe(0);
    expect(result.totalUnsubscriptions).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.bounces).toBe(0);
    expect(result.complaints).toBe(0);
    expect(result.opens).toBe(0);
    expect(result.clicks).toBe(0);
  });
});

describe("AnalyticsRepo.getMetrics — with data", () => {
  it("REQ-AR02: maps counts to correct metric fields in order", async () => {
    const db = makeFakeDb([5, 2, 10, 3, 1, 20, 8]);
    const repo = createAnalyticsRepo(db);
    const result = await repo.getMetrics({ from, to });
    expect(result.totalSubscriptions).toBe(5);
    expect(result.totalUnsubscriptions).toBe(2);
    expect(result.emailsSent).toBe(10);
    expect(result.bounces).toBe(3);
    expect(result.complaints).toBe(1);
    expect(result.opens).toBe(20);
    expect(result.clicks).toBe(8);
  });

  it("REQ-AR03: returns all zeros when all counts are zero", async () => {
    const db = makeFakeDb([0, 0, 0, 0, 0, 0, 0]);
    const repo = createAnalyticsRepo(db);
    const result = await repo.getMetrics({ from, to });
    expect(Object.values(result).every((v) => v === 0)).toBe(true);
  });

  it("REQ-AR04: handles large counts without overflow", async () => {
    const db = makeFakeDb([1000000, 500000, 999999, 100, 50, 800000, 300000]);
    const repo = createAnalyticsRepo(db);
    const result = await repo.getMetrics({ from, to });
    expect(result.totalSubscriptions).toBe(1000000);
    expect(result.emailsSent).toBe(999999);
    expect(result.opens).toBe(800000);
  });

  it("REQ-AR05: runs exactly 7 parallel count queries", async () => {
    let callCount = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            callCount++;
            return Promise.resolve([{ value: 0 }] as CountResult);
          },
        }),
      }),
    } as unknown as Pick<AppDb, "select">;

    const repo = createAnalyticsRepo(db);
    await repo.getMetrics({ from, to });
    expect(callCount).toBe(7);
  });
});

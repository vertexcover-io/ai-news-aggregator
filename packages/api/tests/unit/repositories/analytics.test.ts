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

interface MetricsCase {
  readonly name: string;
  readonly counts: [number, number, number, number, number, number, number];
  readonly expected: {
    totalSubscriptions: number;
    totalUnsubscriptions: number;
    emailsSent: number;
    bounces: number;
    complaints: number;
    opens: number;
    clicks: number;
  };
}

describe("AnalyticsRepo.getMetrics — positional count mapping", () => {
  // The 7 parallel count queries map positionally onto the metric fields.
  // Empty / typical / large-count are one mapping behavior over different
  // inputs; the old "exactly 7 queries" test asserted an implementation detail.
  const cases: MetricsCase[] = [
    {
      name: "empty DB → all zeros",
      counts: [0, 0, 0, 0, 0, 0, 0],
      expected: {
        totalSubscriptions: 0,
        totalUnsubscriptions: 0,
        emailsSent: 0,
        bounces: 0,
        complaints: 0,
        opens: 0,
        clicks: 0,
      },
    },
    {
      name: "typical counts map to fields in order",
      counts: [5, 2, 10, 3, 1, 20, 8],
      expected: {
        totalSubscriptions: 5,
        totalUnsubscriptions: 2,
        emailsSent: 10,
        bounces: 3,
        complaints: 1,
        opens: 20,
        clicks: 8,
      },
    },
    {
      name: "large counts without overflow",
      counts: [1000000, 500000, 999999, 100, 50, 800000, 300000],
      expected: {
        totalSubscriptions: 1000000,
        totalUnsubscriptions: 500000,
        emailsSent: 999999,
        bounces: 100,
        complaints: 50,
        opens: 800000,
        clicks: 300000,
      },
    },
  ];

  it.each(cases)(
    "REQ-AR01/02/04: $name",
    async ({ counts, expected }) => {
      const db = makeFakeDb(counts);
      const repo = createAnalyticsRepo(db);
      const result = await repo.getMetrics({ from, to });
      expect(result).toEqual(expected);
    },
  );
});

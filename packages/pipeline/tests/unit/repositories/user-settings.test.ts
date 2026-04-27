import { describe, it, expect, vi } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings";

interface StoredRow {
  id: string;
  singleton: boolean;
  topN: number;
  halfLifeHours: number | null;
  hnConfig: unknown;
  redditConfig: unknown;
  webConfig: unknown;
  scheduleTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
  updatedAt: Date | string;
}

function makeFakeDb(rows: StoredRow[]): Pick<AppDb, "select"> {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rows)),
        })),
      })),
    })),
  } as unknown as Pick<AppDb, "select">;
}

const baseRow: StoredRow = {
  id: "00000000-0000-0000-0000-000000000001",
  singleton: true,
  topN: 10,
  halfLifeHours: 24,
  hnConfig: { sinceDays: 1 },
  redditConfig: null,
  webConfig: null,
  scheduleTime: "09:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: true,
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

describe("createUserSettingsRepo.get", () => {
  it("returns null when DB returns empty array", async () => {
    const db = makeFakeDb([]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    expect(result).toBeNull();
  });

  it("returns a mapped UserSettings with all fields when DB returns a row", async () => {
    const db = makeFakeDb([baseRow]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.id).toBe(baseRow.id);
    expect(result.topN).toBe(baseRow.topN);
    expect(result.halfLifeHours).toBe(baseRow.halfLifeHours);
    expect(result.hnConfig).toEqual(baseRow.hnConfig);
    expect(result.redditConfig).toBeNull();
    expect(result.webConfig).toBeNull();
    expect(result.scheduleTime).toBe(baseRow.scheduleTime);
    expect(result.scheduleTimezone).toBe(baseRow.scheduleTimezone);
    expect(result.scheduleEnabled).toBe(baseRow.scheduleEnabled);
  });

  it("uses toISOString() when updatedAt is a Date instance", async () => {
    const date = new Date("2026-04-01T12:00:00Z");
    const db = makeFakeDb([{ ...baseRow, updatedAt: date }]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.updatedAt).toBe(date.toISOString());
  });

  it("uses String(updatedAt) when updatedAt is a string (coercion fallback path)", async () => {
    const dateStr = "2026-04-01T12:00:00.000Z";
    const db = makeFakeDb([{ ...baseRow, updatedAt: dateStr }]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    expect(result).not.toBeNull();
    if (result === null) return;
    // When updatedAt is already a string, String(updatedAt) returns the same string
    expect(result.updatedAt).toBe(dateStr);
  });
});

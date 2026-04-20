import { describe, it, expect, vi } from "vitest";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSettingsSelect } from "@newsletter/shared/db";

interface FakeDbResult {
  db: Pick<AppDb, "select">;
}

function createFakeDb(rows: UserSettingsSelect[]): FakeDbResult {
  const limitBuilder = {
    then: (
      resolve: (value: UserSettingsSelect[]) => unknown,
    ): Promise<unknown> => Promise.resolve(rows).then(resolve),
  };

  const whereBuilder = {
    limit: (_n: number): typeof limitBuilder => limitBuilder,
  };

  const fromBuilder = {
    where: (_arg: unknown): typeof whereBuilder => whereBuilder,
  };

  const selectBuilder = {
    from: (_table: unknown): typeof fromBuilder => fromBuilder,
  };

  const db = {
    select: vi.fn(() => selectBuilder),
  } as unknown as Pick<AppDb, "select">;

  return { db };
}

function makeRow(overrides: Partial<UserSettingsSelect> = {}): UserSettingsSelect {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    singleton: true,
    topN: 10,
    halfLifeHours: 24,
    hnConfig: null,
    redditConfig: null,
    webConfig: null,
    scheduleTime: "08:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    updatedAt: new Date("2026-04-20T08:00:00Z"),
    ...overrides,
  };
}

describe("createUserSettingsRepo.get", () => {
  it("returns null when DB returns empty array", async () => {
    const { db } = createFakeDb([]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    expect(result).toBeNull();
  });

  it("returns a UserSettings object with all fields when DB returns one row", async () => {
    const row = makeRow({
      id: "abc-123",
      topN: 20,
      halfLifeHours: 48,
      scheduleTime: "09:00",
      scheduleTimezone: "America/New_York",
      scheduleEnabled: true,
    });
    const { db } = createFakeDb([row]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    expect(result).toMatchObject({
      id: "abc-123",
      topN: 20,
      halfLifeHours: 48,
      scheduleTime: "09:00",
      scheduleTimezone: "America/New_York",
      scheduleEnabled: true,
      hnConfig: null,
      redditConfig: null,
      webConfig: null,
    });
  });

  it("converts updatedAt Date to ISO string", async () => {
    const updatedAt = new Date("2026-04-20T10:30:00Z");
    const { db } = createFakeDb([makeRow({ updatedAt })]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    if (result === null) throw new Error("expected non-null result");
    expect(result.updatedAt).toBe("2026-04-20T10:30:00.000Z");
  });

  it("converts updatedAt plain string to string via String()", async () => {
    const row = makeRow({ updatedAt: "2026-04-20T10:30:00Z" as unknown as Date });
    const { db } = createFakeDb([row]);
    const repo = createUserSettingsRepo(db);

    const result = await repo.get();

    if (result === null) throw new Error("expected non-null result");
    expect(typeof result.updatedAt).toBe("string");
    expect(result.updatedAt).toBe("2026-04-20T10:30:00Z");
  });
});

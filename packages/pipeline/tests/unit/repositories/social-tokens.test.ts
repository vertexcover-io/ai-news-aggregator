import { describe, expect, it, vi } from "vitest";
import {
  createSocialTokensRepo,
  type SaveSocialTokenInput,
  type SocialPlatform,
  type SocialTokensTx,
} from "@pipeline/repositories/social-tokens";
import type { AppDb } from "@newsletter/shared/db";

interface FakeDbHandle {
  db: Pick<AppDb, "select" | "insert" | "transaction">;
  selectRows: { value: unknown[] };
  selectSpy: ReturnType<typeof vi.fn>;
  insertSpy: ReturnType<typeof vi.fn>;
  insertValuesSpy: ReturnType<typeof vi.fn>;
  insertOnConflictSpy: ReturnType<typeof vi.fn>;
  selectForCalls: { value: number };
}

function makeFakeDb(initialSelectRows: unknown[] = []): FakeDbHandle {
  const selectRows = { value: initialSelectRows };
  const selectForCalls = { value: 0 };

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    for: vi.fn(function forImpl(this: unknown) {
      selectForCalls.value += 1;
      return Promise.resolve(selectRows.value);
    }),
    then: (resolve: (rows: unknown[]) => unknown) => resolve(selectRows.value),
  };
  const selectSpy = vi.fn(() => selectChain);

  const onConflictSpy = vi.fn().mockResolvedValue(undefined);
  const valuesSpy = vi.fn(() => ({ onConflictDoUpdate: onConflictSpy }));
  const insertSpy = vi.fn(() => ({ values: valuesSpy }));

  const db = {
    select: selectSpy,
    insert: insertSpy,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        select: selectSpy,
        insert: insertSpy,
      });
    }),
  } as unknown as Pick<AppDb, "select" | "insert" | "transaction">;

  return {
    db,
    selectRows,
    selectSpy,
    insertSpy,
    insertValuesSpy: valuesSpy,
    insertOnConflictSpy: onConflictSpy,
    selectForCalls,
  };
}

describe("SocialTokensRepo.getToken", () => {
  it("returns null when no row exists", async () => {
    const handle = makeFakeDb([]);
    const repo = createSocialTokensRepo(handle.db);
    const result = await repo.getToken("linkedin");
    expect(result).toBeNull();
  });

  it("returns parsed row when present", async () => {
    const expiresAt = new Date("2026-06-01T00:00:00Z");
    const updatedAt = new Date("2026-05-01T00:00:00Z");
    const handle = makeFakeDb([
      {
        platform: "linkedin",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt,
        metadata: { personUrn: "urn:li:person:abc" },
        updatedAt,
      },
    ]);
    const repo = createSocialTokensRepo(handle.db);
    const result = await repo.getToken("linkedin");
    expect(result).toEqual({
      platform: "linkedin",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt,
      metadata: { personUrn: "urn:li:person:abc" },
      updatedAt,
    });
  });
});

describe("SocialTokensRepo.saveToken", () => {
  it("upserts via onConflictDoUpdate on the platform PK", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db);
    const input: SaveSocialTokenInput = {
      accessToken: "at-new",
      refreshToken: "rt-new",
      expiresAt: new Date("2026-07-01T00:00:00Z"),
      metadata: null,
    };
    await repo.saveToken("twitter", input);
    expect(handle.insertSpy).toHaveBeenCalledOnce();
    expect(handle.insertValuesSpy).toHaveBeenCalledOnce();
    const valuesArg = handle.insertValuesSpy.mock.calls[0]?.[0];
    expect(valuesArg).toMatchObject({
      platform: "twitter",
      accessToken: "at-new",
      refreshToken: "rt-new",
      expiresAt: input.expiresAt,
      metadata: null,
    });
    expect(handle.insertOnConflictSpy).toHaveBeenCalledOnce();
    const conflictArg = handle.insertOnConflictSpy.mock.calls[0]?.[0];
    expect(conflictArg.target).toBeDefined();
    expect(conflictArg.set).toMatchObject({
      accessToken: "at-new",
      refreshToken: "rt-new",
      expiresAt: input.expiresAt,
      metadata: null,
    });
  });
});

describe("SocialTokensRepo.withTokenLock", () => {
  it("opens a transaction, locks the row with FOR UPDATE, and exposes saveToken on tx", async () => {
    const handle = makeFakeDb([
      {
        platform: "twitter" as const,
        accessToken: "old-at",
        refreshToken: "old-rt",
        expiresAt: new Date("2026-04-01T00:00:00Z"),
        metadata: null,
        updatedAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);
    const repo = createSocialTokensRepo(handle.db);

    const observed: { row: unknown; txSaveCalled: boolean } = {
      row: null,
      txSaveCalled: false,
    };

    const result = await repo.withTokenLock(
      "twitter",
      async (row, tx: SocialTokensTx) => {
        observed.row = row;
        await tx.saveToken("twitter" satisfies SocialPlatform, {
          accessToken: "fresh-at",
          refreshToken: "fresh-rt",
          expiresAt: new Date("2026-08-01T00:00:00Z"),
        });
        observed.txSaveCalled = true;
        return "ok" as const;
      },
    );

    expect(result).toBe("ok");
    expect(handle.selectForCalls.value).toBe(1);
    expect(observed.txSaveCalled).toBe(true);
    expect(observed.row).toMatchObject({
      platform: "twitter",
      accessToken: "old-at",
    });
    expect(handle.insertSpy).toHaveBeenCalledOnce();
  });

  it("passes null to the callback when no token row exists", async () => {
    const handle = makeFakeDb([]);
    const repo = createSocialTokensRepo(handle.db);
    let observedRow: unknown = "untouched";
    await repo.withTokenLock("linkedin", (row) => {
      observedRow = row;
      return Promise.resolve(undefined);
    });
    expect(observedRow).toBeNull();
    expect(handle.selectForCalls.value).toBe(1);
  });
});

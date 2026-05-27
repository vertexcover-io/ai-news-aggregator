/**
 * TDD tests for cipher-aware social-tokens repository (Phase 1: REQ-006, EDGE-005).
 *
 * Tests cover:
 *   - encrypt->saveToken->read round-trip yields original access/refresh tokens (REQ-006)
 *   - raw DB value (encrypted_fields jsonb) contains NO plaintext token substring (REQ-006)
 *   - decrypting with a different SESSION_SECRET throws (EDGE-005)
 *   - withTokenLock still passes decrypted tokens to the callback
 *   - null row handling unchanged
 */

import { describe, expect, it, vi } from "vitest";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  createSocialTokensRepo,
  type SaveSocialTokenInput,
  type SocialTokensTx,
} from "@pipeline/repositories/social-tokens";
import type { AppDb } from "@newsletter/shared/db";
import type { SocialTokenEncryptedFields } from "@newsletter/shared/db";

// ---------------------------------------------------------------------------
// Fake DB -- stores the raw jsonb value so we can inspect the encrypted blob
// ---------------------------------------------------------------------------

interface StoredRow {
  platform: string;
  encryptedFields: SocialTokenEncryptedFields;
  expiresAt: Date;
  metadata: unknown;
  updatedAt: Date;
}

interface FakeDbHandle {
  db: Pick<AppDb, "select" | "insert" | "transaction">;
  rows: Map<string, StoredRow>;
  selectForCalls: { value: number };
}

function makeFakeDb(initial: StoredRow[] = []): FakeDbHandle {
  const rows = new Map<string, StoredRow>();
  for (const r of initial) rows.set(r.platform, r);
  const selectForCalls = { value: 0 };

  function makeSelectChain(pendingPlatform: { value: string | null }) {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn(function (_pred: unknown) {
        const p = _pred as { queryChunks?: unknown[] } | null;
        if (p && Array.isArray(p.queryChunks)) {
          for (const chunk of p.queryChunks) {
            if (typeof chunk === "string") {
              pendingPlatform.value = chunk;
            } else if (chunk && typeof chunk === "object" && "value" in chunk) {
              const v = (chunk as { value: unknown }).value;
              if (typeof v === "string") pendingPlatform.value = v;
            }
          }
        }
        return chain;
      }),
      limit: vi.fn(function () {
        const p = pendingPlatform.value;
        pendingPlatform.value = null;
        if (p === null) return Promise.resolve([...rows.values()]);
        const row = rows.get(p);
        return {
          for: vi.fn(function () {
            selectForCalls.value += 1;
            return Promise.resolve(row ? [row] : []);
          }),
          then: (resolve: (v: StoredRow[]) => unknown) =>
            Promise.resolve(row ? [row] : []).then(resolve),
        };
      }),
    };
    return chain;
  }

  const selectFn = vi.fn(() => {
    const pendingPlatform: { value: string | null } = { value: null };
    return makeSelectChain(pendingPlatform);
  });

  function makeInsertChain() {
    return {
      values: vi.fn(function (v: StoredRow) {
        return {
          onConflictDoUpdate: vi.fn(function (conf: {
            target: unknown;
            set: Partial<StoredRow>;
          }) {
            const existing = rows.get(v.platform);
            if (existing) {
              rows.set(v.platform, { ...existing, ...conf.set });
            } else {
              rows.set(v.platform, v);
            }
            return Promise.resolve(undefined);
          }),
        };
      }),
    };
  }

  const insertFn = vi.fn(() => makeInsertChain());

  const db = {
    select: selectFn,
    insert: insertFn,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txSelectFn = vi.fn(() => {
        const pendingPlatform: { value: string | null } = { value: null };
        return makeSelectChain(pendingPlatform);
      });
      const txInsertFn = vi.fn(() => makeInsertChain());
      return fn({ select: txSelectFn, insert: txInsertFn });
    }),
  } as unknown as Pick<AppDb, "select" | "insert" | "transaction">;

  return { db, rows, selectForCalls };
}

// ---------------------------------------------------------------------------
// Cipher factories
// ---------------------------------------------------------------------------

const TEST_SECRET_A = "0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_SECRET_B = "fedcba9876543210fedcba9876543210fedcba9876543210";

function cipherA() {
  return getCredentialCipher({ ...process.env, SESSION_SECRET: TEST_SECRET_A });
}

function cipherB() {
  return getCredentialCipher({ ...process.env, SESSION_SECRET: TEST_SECRET_B });
}

// ---------------------------------------------------------------------------
// REQ-006: encrypt->saveToken->read round-trip
// ---------------------------------------------------------------------------

describe("SocialTokensRepo (cipher-aware) -- encrypt->save->read round-trip (REQ-006)", () => {
  it("getToken returns the original plaintext access and refresh tokens after saveToken", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db, cipherA());

    const expiresAt = new Date("2026-12-01T00:00:00Z");
    const input: SaveSocialTokenInput = {
      accessToken: "my-access-token-secret-value",
      refreshToken: "my-refresh-token-secret-value",
      expiresAt,
      metadata: { personUrn: "urn:li:person:abc123" },
    };

    await repo.saveToken("linkedin", input);

    const result = await repo.getToken("linkedin");

    if (result === null) throw new Error("expected non-null result from getToken");
    expect(result.accessToken).toBe("my-access-token-secret-value");
    expect(result.refreshToken).toBe("my-refresh-token-secret-value");
    expect(result.expiresAt).toEqual(expiresAt);
    expect(result.metadata).toEqual({ personUrn: "urn:li:person:abc123" });
    expect(result.platform).toBe("linkedin");
  });

  it("withTokenLock callback receives decrypted accessToken and refreshToken", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db, cipherA());

    await repo.saveToken("linkedin", {
      accessToken: "lock-access-token",
      refreshToken: "lock-refresh-token",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    });

    const repo2 = createSocialTokensRepo(handle.db, cipherA());

    let observedAccessToken: string | null = null;
    let observedRefreshToken: string | null = null;

    await repo2.withTokenLock("linkedin", (row, _tx: SocialTokensTx) => {
      observedAccessToken = row?.accessToken ?? null;
      observedRefreshToken = row?.refreshToken ?? null;
      return Promise.resolve(undefined);
    });

    expect(observedAccessToken).toBe("lock-access-token");
    expect(observedRefreshToken).toBe("lock-refresh-token");
  });
});

// ---------------------------------------------------------------------------
// REQ-006: raw DB value must NOT contain plaintext token
// ---------------------------------------------------------------------------

describe("SocialTokensRepo (cipher-aware) -- raw DB value is ciphertext (REQ-006)", () => {
  it("the raw encryptedFields stored in the DB contains no plaintext token substring", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db, cipherA());

    const accessToken = "super-secret-access-token-12345";
    const refreshToken = "ultra-secret-refresh-token-67890";

    await repo.saveToken("twitter", {
      accessToken,
      refreshToken,
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    });

    const rawRow = handle.rows.get("twitter");
    if (rawRow === undefined) throw new Error("expected twitter row to be stored");

    const rawRowKeys = Object.keys(rawRow);
    expect(rawRowKeys).not.toContain("accessToken");
    expect(rawRowKeys).not.toContain("access_token");
    expect(rawRowKeys).not.toContain("refreshToken");
    expect(rawRowKeys).not.toContain("refresh_token");
    expect(rawRowKeys).toContain("encryptedFields");

    const serialised = JSON.stringify(rawRow.encryptedFields);
    expect(serialised).not.toContain(accessToken);
    expect(serialised).not.toContain(refreshToken);
  });
});

// ---------------------------------------------------------------------------
// EDGE-005: wrong SESSION_SECRET -> decrypt throws
// ---------------------------------------------------------------------------

describe("SocialTokensRepo (cipher-aware) -- wrong SESSION_SECRET throws on decrypt (EDGE-005)", () => {
  it("getToken throws when trying to decrypt with a different SESSION_SECRET", async () => {
    const handle = makeFakeDb();

    const repoA = createSocialTokensRepo(handle.db, cipherA());
    await repoA.saveToken("linkedin", {
      accessToken: "secret-at",
      refreshToken: "secret-rt",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    });

    const repoB = createSocialTokensRepo(handle.db, cipherB());
    await expect(repoB.getToken("linkedin")).rejects.toThrow();
  });

  it("withTokenLock throws when the stored token was encrypted with a different SESSION_SECRET", async () => {
    const handle = makeFakeDb();

    const repoA = createSocialTokensRepo(handle.db, cipherA());
    await repoA.saveToken("twitter", {
      accessToken: "secret-at",
      refreshToken: "secret-rt",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    });

    const repoB = createSocialTokensRepo(handle.db, cipherB());
    await expect(
      repoB.withTokenLock("twitter", (_row) => Promise.resolve(undefined)),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Null row handling unchanged
// ---------------------------------------------------------------------------

describe("SocialTokensRepo (cipher-aware) -- null row handling", () => {
  it("getToken returns null when no row exists", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db, cipherA());
    expect(await repo.getToken("linkedin")).toBeNull();
  });

  it("withTokenLock passes null to callback when no row exists", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db, cipherA());
    let observedRow: unknown = "untouched";
    await repo.withTokenLock("linkedin", (row) => {
      observedRow = row;
      return Promise.resolve(undefined);
    });
    expect(observedRow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// withTokenLock: saveToken inside tx writes encrypted value
// ---------------------------------------------------------------------------

describe("SocialTokensRepo (cipher-aware) -- withTokenLock saves encrypted tokens", () => {
  it("token saved inside withTokenLock callback is encrypted at rest", async () => {
    const handle = makeFakeDb();
    const repo = createSocialTokensRepo(handle.db, cipherA());

    const newAccessToken = "fresh-access-plaintext";
    const newRefreshToken = "fresh-refresh-plaintext";

    await repo.withTokenLock("twitter", async (_row, tx: SocialTokensTx) => {
      await tx.saveToken("twitter", {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      });
    });

    const rawRow = handle.rows.get("twitter");
    if (rawRow === undefined) throw new Error("expected twitter row to be stored");
    const serialised = JSON.stringify(rawRow.encryptedFields);
    expect(serialised).not.toContain(newAccessToken);
    expect(serialised).not.toContain(newRefreshToken);
  });
});

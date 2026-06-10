import { describe, it, expect } from "vitest";
import { createSocialTokensRepo } from "../social-tokens.js";
import type { SocialTokenEncryptedFields } from "@newsletter/shared/db";
import { BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
import type { CredentialCipher, EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import type { SocialTokenMetadata } from "@newsletter/shared/types";

const TAG = "ENC:";

function makeCipher(): CredentialCipher {
  return {
    encrypt(text: string): EncryptedBlob {
      return Buffer.from(TAG + text).toString("base64") as EncryptedBlob;
    },
    decrypt(blob: EncryptedBlob): string {
      const raw = Buffer.from(blob, "base64").toString("utf-8");
      if (!raw.startsWith(TAG)) throw new Error("bad cipher text");
      return raw.slice(TAG.length);
    },
  };
}

interface StoredRow {
  tenantId: string;
  platform: string;
  encryptedFields: SocialTokenEncryptedFields;
  expiresAt: Date;
  metadata: SocialTokenMetadata | null;
  updatedAt: Date;
}

/**
 * Simple in-memory DB that resolves drizzle chain by inspecting condition parameters via JSON.
 * This is purposely minimal — it only supports eq() and and() conditions with platform + optional tenantId.
 */
function makeMockDb(rows: StoredRow[]) {
  /** Extract the "platform" value from the queryChunks inside a drizzle condition object. */
  function resolvePlatform(cond: unknown): string | undefined {
    // The drizzle and()/eq() conditions have a "queryChunks" property.
    // Walk the tree to find a string value of "linkedin" or "twitter".
    const visited = new WeakSet();
    function walk(obj: unknown): string | undefined {
      if (obj === null || obj === undefined) return;
      if (typeof obj === "string") {
        if (obj === "linkedin" || obj === "twitter") return obj;
        return;
      }
      if (typeof obj !== "object") return;
      const o = obj as Record<string, unknown>;
      if (visited.has(o as object)) return;
      visited.add(o as object);
      for (const v of Object.values(o)) {
        const found = walk(v);
        if (found) return found;
      }
      return;
    }
    return walk(cond);
  }

  const db = {
    select() {
      return {
        from(_t: unknown) {
          return {
            where(cond: unknown) {
              const platform = resolvePlatform(cond);
              return {
                limit(_n: number) {
                  const filtered = platform
                    ? rows.filter((r) => r.platform === platform)
                    : rows;
                  return filtered.slice(0, _n);
                },
              };
            },
          };
        },
      };
    },
    insert(_t: unknown) {
      return {
        values(input: {
          tenantId: string; platform: string;
          encryptedFields: SocialTokenEncryptedFields;
          expiresAt: Date; metadata: SocialTokenMetadata | null; updatedAt: Date;
        }) {
          return {
            onConflictDoUpdate(_opts: { target: unknown[]; set: Record<string, unknown> }) {
              const idx = rows.findIndex(
                (r) => r.tenantId === input.tenantId && r.platform === input.platform,
              );
              const row: StoredRow = { ...input };
              if (idx >= 0) rows[idx] = row;
              else rows.push(row);
              return row;
            },
          };
        },
      };
    },
    delete(_t: unknown) {
      return {
        where(cond: unknown) {
          const platform = resolvePlatform(cond);
          return {
            returning(_col: unknown) {
              if (platform) {
                const idx = rows.findIndex((r) => r.platform === platform);
                if (idx >= 0) {
                  const removed = rows.splice(idx, 1);
                  return removed;
                }
              }
              return [];
            },
          };
        },
      };
    },
  };
  return { db, rows };
}

describe("createSocialTokensRepo", () => {
  const cipher = makeCipher();

  describe("saveToken", () => {
    it("encrypts and upserts tokens with tenantId", async () => {
      const { db, rows } = makeMockDb([]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      await repo.saveToken("twitter", {
        accessToken: "at-save",
        refreshToken: "rt-save",
        expiresAt: new Date("2026-06-30T00:00:00.000Z"),
        metadata: { name: "savetest" },
      });
      expect(rows.length).toBe(1);
      expect(rows[0].platform).toBe("twitter");
      expect(cipher.decrypt(rows[0].encryptedFields.accessToken)).toBe("at-save");
      expect(cipher.decrypt(rows[0].encryptedFields.refreshToken)).toBe("rt-save");
      expect(rows[0].expiresAt).toEqual(new Date("2026-06-30T00:00:00.000Z"));
    });

    it("handles null refreshToken with empty string sentinel", async () => {
      const { db, rows } = makeMockDb([]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      await repo.saveToken("twitter", {
        accessToken: "at-no-refresh",
        refreshToken: null,
        expiresAt: new Date(),
      });
      expect(cipher.decrypt(rows[0].encryptedFields.refreshToken)).toBe("");
    });

    it("upserts correctly (second save replaces first)", async () => {
      const { db, rows } = makeMockDb([]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      await repo.saveToken("twitter", {
        accessToken: "first",
        refreshToken: "rt1",
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await repo.saveToken("twitter", {
        accessToken: "second",
        refreshToken: "rt2",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      });
      expect(rows.length).toBe(1);
      expect(cipher.decrypt(rows[0].encryptedFields.accessToken)).toBe("second");
    });
  });

  describe("getToken", () => {
    it("returns null when no row exists", async () => {
      const { db } = makeMockDb([]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      expect(await repo.getToken("twitter")).toBeNull();
    });

    it("returns decrypted token for correct platform", async () => {
      const { db } = makeMockDb([{
        tenantId: "t1",
        platform: "twitter",
        encryptedFields: {
          accessToken: cipher.encrypt("tw-at"),
          refreshToken: cipher.encrypt("tw-rt"),
        },
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        metadata: { name: "testuser" },
        updatedAt: new Date(),
      }]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      const result = await repo.getToken("twitter");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected result not null");
      expect(result.accessToken).toBe("tw-at");
      expect(result.refreshToken).toBe("tw-rt");
      expect(result.expiresAt).toEqual(new Date("2026-06-01T00:00:00.000Z"));
      expect(result.metadata).toEqual({ name: "testuser" });
    });

    it("returns null for wrong platform", async () => {
      const { db } = makeMockDb([{
        tenantId: "t1",
        platform: "linkedin",
        encryptedFields: {
          accessToken: cipher.encrypt("li-at"),
          refreshToken: cipher.encrypt("li-rt"),
        },
        expiresAt: new Date(),
        metadata: null,
        updatedAt: new Date(),
      }]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      expect(await repo.getToken("twitter")).toBeNull();
    });
  });

  describe("deleteToken", () => {
    it("removes a row and returns true", async () => {
      const rows: StoredRow[] = [{
        tenantId: "t1",
        platform: "twitter",
        encryptedFields: {
          accessToken: cipher.encrypt("at"),
          refreshToken: cipher.encrypt("rt"),
        },
        expiresAt: new Date(),
        metadata: null,
        updatedAt: new Date(),
      }];
      const { db } = makeMockDb(rows);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      const result = await repo.deleteToken("twitter");
      expect(result).toBe(true);
      expect(rows.length).toBe(0);
    });

    it("returns false when no row exists", async () => {
      const { db } = makeMockDb([]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      const result = await repo.deleteToken("linkedin");
      expect(result).toBe(false);
    });
  });

  describe("getLinkedIn / getTwitter convenience methods", () => {
    it("getLinkedIn returns LinkedIn token", async () => {
      const { db } = makeMockDb([{
        tenantId: "t1",
        platform: "linkedin",
        encryptedFields: {
          accessToken: cipher.encrypt("li-at"),
          refreshToken: cipher.encrypt("li-rt"),
        },
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        metadata: { personUrn: "urn:li:person:123" },
        updatedAt: new Date(),
      }]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      const result = await repo.getLinkedIn();
      if (!result) throw new Error("expected result not null");
      expect(result.accessToken).toBe("li-at");
      expect(result.metadata?.personUrn).toBe("urn:li:person:123");
    });

    it("getTwitter returns Twitter token", async () => {
      const { db } = makeMockDb([{
        tenantId: "t1",
        platform: "twitter",
        encryptedFields: {
          accessToken: cipher.encrypt("tw-at"),
          refreshToken: cipher.encrypt("tw-rt"),
        },
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        metadata: { name: "testtwitteruser" },
        updatedAt: new Date(),
      }]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      const result = await repo.getTwitter();
      if (!result) throw new Error("expected result not null");
      expect(result.accessToken).toBe("tw-at");
      expect(result.metadata?.name).toBe("testtwitteruser");
    });

    it("getTwitter returns null when no row", async () => {
      const { db } = makeMockDb([]);
      const repo = createSocialTokensRepo(db, BOOTSTRAP_CONTEXT, cipher);
      expect(await repo.getTwitter()).toBeNull();
    });
  });
});

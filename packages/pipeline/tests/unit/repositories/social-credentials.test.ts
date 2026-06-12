import { describe, it, expect, vi } from "vitest";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import {
  createSocialCredentialsRepo,
  type SocialCredentialsRepo,
} from "@pipeline/repositories/social-credentials.js";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterEncryptedFields,
} from "@newsletter/shared/db";

type Platform = "linkedin" | "twitter";

interface FakeRow {
  platform: Platform;
  encryptedFields: LinkedInEncryptedFields | TwitterEncryptedFields;
  metadata: { apiVersion?: string } | null;
  updatedAt: Date;
  updatedBy: string | null;
}

interface FakeDb {
  rows: Map<Platform, FakeRow>;
  db: Pick<AppDb, "select" | "insert" | "delete">;
  lastInsertValues: { value: unknown };
}

function extractPlatformFromPredicate(predicate: unknown): Platform | null {
  // The repo composes and(eq(tenantId), eq(platform)): the platform Param sits
  // inside a nested SQL chunk, so walk the predicate tree recursively.
  if (predicate === "linkedin" || predicate === "twitter") return predicate;
  if (predicate === null || typeof predicate !== "object") return null;
  if ("value" in predicate) {
    const v = (predicate as { value: unknown }).value;
    if (v === "linkedin" || v === "twitter") return v;
  }
  if ("queryChunks" in predicate) {
    const chunks = (predicate as { queryChunks: unknown }).queryChunks;
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) {
        const found = extractPlatformFromPredicate(chunk);
        if (found !== null) return found;
      }
    }
  }
  return null;
}

function makeFakeDb(initial: FakeRow[] = []): FakeDb {
  const rows = new Map<Platform, FakeRow>();
  for (const r of initial) rows.set(r.platform, r);
  const lastInsertValues: { value: unknown } = { value: null };

  let pendingFilter: Platform | null = null;
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(function whereImpl(this: unknown, predicate: unknown) {
      pendingFilter = extractPlatformFromPredicate(predicate);
      return selectChain;
    }),
    limit: vi.fn(function limitImpl(this: unknown) {
      const platform = pendingFilter;
      pendingFilter = null;
      if (platform === null) return Promise.resolve([...rows.values()]);
      const row = rows.get(platform);
      return Promise.resolve(row ? [row] : []);
    }),
  };

  const selectFn = vi.fn(() => selectChain);

  // insert(table).values(v).onConflictDoUpdate({...})
  const insertChain = {
    values: vi.fn(function valuesImpl(this: unknown, v: FakeRow) {
      lastInsertValues.value = v;
      return {
        onConflictDoUpdate: vi.fn(function onConflictImpl(this: unknown, conf: { set: Partial<FakeRow> }) {
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
  const insertFn = vi.fn(() => insertChain);

  // delete(table).where(eq(platform, p)).returning()
  const deleteChain = {
    where: vi.fn(function dWhere(this: unknown, predicate: unknown) {
      const platform = extractPlatformFromPredicate(predicate);
      return {
        returning: vi.fn(() => {
          if (platform === null) return Promise.resolve([]);
          const existed = rows.delete(platform);
          return Promise.resolve(existed ? [{ platform }] : []);
        }),
      };
    }),
  };
  const deleteFn = vi.fn(() => deleteChain);

  const db = {
    select: selectFn,
    insert: insertFn,
    delete: deleteFn,
  } as unknown as Pick<AppDb, "select" | "insert" | "delete">;

  return { rows, db, lastInsertValues };
}

function makeRepoWithCipher(): {
  repo: SocialCredentialsRepo;
  fake: FakeDb;
} {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  const cipher = getCredentialCipher(env);
  const fake = makeFakeDb();
  const repo = createSocialCredentialsRepo(fake.db, TENANT_ZERO_ID, cipher);
  return { repo, fake };
}

describe("SocialCredentialsRepo — LinkedIn round trip (VS-2)", () => {
  it("encrypts on write and decrypts on read, with ciphertext never equal to plaintext at rest", async () => {
    const { repo, fake } = makeRepoWithCipher();

    await repo.upsertLinkedIn({
      clientId: "abc",
      clientSecret: "xyz",
      apiVersion: "202511",
    });

    // ciphertext at rest assertion
    const row = fake.rows.get("linkedin");
    if (!row) throw new Error("expected linkedin row to be present");
    const fields = row.encryptedFields as LinkedInEncryptedFields;
    expect(fields.clientId).toBeDefined();
    expect(fields.clientId.ct).not.toBe("abc");
    expect(fields.clientSecret.ct).not.toBe("xyz");
    expect(row.metadata).toEqual({ apiVersion: "202511" });

    const got = await repo.getLinkedIn();
    if (got === null) throw new Error("expected non-null result from getLinkedIn");
    expect(got.clientId).toBe("abc");
    expect(got.clientSecret).toBe("xyz");
    expect(got.apiVersion).toBe("202511");
  });

  it("apiVersion is null when not provided on upsert", async () => {
    const { repo, fake } = makeRepoWithCipher();
    await repo.upsertLinkedIn({ clientId: "id", clientSecret: "sec" });
    const got = await repo.getLinkedIn();
    if (got === null) throw new Error("expected non-null result from getLinkedIn");
    expect(got.apiVersion).toBeNull();
    const row = fake.rows.get("linkedin");
    if (!row) throw new Error("expected linkedin row to be present");
    expect(row.metadata).toBeNull();
  });
});

describe("SocialCredentialsRepo — Twitter round trip", () => {
  it("encrypts all 4 fields on write and decrypts on read", async () => {
    const { repo, fake } = makeRepoWithCipher();

    await repo.upsertTwitter({
      apiKey: "k1",
      apiSecret: "s1",
      accessToken: "t1",
      accessTokenSecret: "ts1",
    });

    const row = fake.rows.get("twitter");
    if (!row) throw new Error("expected twitter row to be present");
    const fields = row.encryptedFields as TwitterEncryptedFields;
    expect(fields.apiKey.ct).not.toBe("k1");
    expect(fields.apiSecret.ct).not.toBe("s1");
    expect(fields.accessToken.ct).not.toBe("t1");
    expect(fields.accessTokenSecret.ct).not.toBe("ts1");

    const got = await repo.getTwitter();
    expect(got).toEqual({
      apiKey: "k1",
      apiSecret: "s1",
      accessToken: "t1",
      accessTokenSecret: "ts1",
      updatedAt: expect.any(Date),
    });
  });
});

describe("SocialCredentialsRepo — get returns null for missing rows", () => {
  it("getLinkedIn returns null when no row exists", async () => {
    const { repo } = makeRepoWithCipher();
    expect(await repo.getLinkedIn()).toBeNull();
  });

  it("getTwitter returns null when no row exists", async () => {
    const { repo } = makeRepoWithCipher();
    expect(await repo.getTwitter()).toBeNull();
  });
});

describe("SocialCredentialsRepo — delete", () => {
  it("returns true when row existed, false otherwise", async () => {
    const { repo } = makeRepoWithCipher();
    await repo.upsertLinkedIn({ clientId: "a", clientSecret: "b" });
    expect(await repo.delete("linkedin")).toBe(true);
    expect(await repo.delete("linkedin")).toBe(false);
  });
});


/**
 * Tenant-level social-credentials repo (P12): rows keyed (tenant_id,
 * platform), holding ONLY the tenant's Twitter OAuth1 posting keys —
 * encrypted at rest (REQ-083). App-level secrets live in app-credentials.ts
 * (see app-credentials.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  createSocialCredentialsRepo,
  type SocialCredentialsRepo,
} from "@pipeline/repositories/social-credentials.js";
import type { AppDb } from "@newsletter/shared/db";
import type { TwitterEncryptedFields } from "@newsletter/shared/db";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

interface FakeRow {
  platform: "twitter";
  tenantId?: string;
  encryptedFields: TwitterEncryptedFields;
  metadata: { apiVersion?: string } | null;
  updatedAt: Date;
  updatedBy: string | null;
}

interface FakeDb {
  rows: Map<string, FakeRow>;
  db: Pick<AppDb, "select" | "insert" | "delete">;
  lastInsertValues: { value: FakeRow | null };
}

/** Recursively digs the platform literal out of a drizzle predicate (and()/eq() nest SQL chunks). */
function extractPlatformFromPredicate(predicate: unknown): "twitter" | null {
  if (predicate === "twitter") return "twitter";
  if (predicate === null || typeof predicate !== "object") return null;
  if ("value" in predicate) {
    const v = (predicate as { value: unknown }).value;
    if (v === "twitter") return "twitter";
  }
  if ("queryChunks" in predicate) {
    const chunks = (predicate as { queryChunks: unknown[] }).queryChunks;
    for (const chunk of chunks) {
      const found = extractPlatformFromPredicate(chunk);
      if (found !== null) return found;
    }
  }
  return null;
}

function makeFakeDb(initial: FakeRow[] = []): FakeDb {
  const rows = new Map<string, FakeRow>();
  for (const r of initial) rows.set(r.platform, r);
  const lastInsertValues: { value: FakeRow | null } = { value: null };

  let pendingFilter: "twitter" | null = null;
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
  const repo = createSocialCredentialsRepo(fake.db, cipher, {
    tenantId: TENANT_A,
    role: "tenant_admin",
  });
  return { repo, fake };
}

describe("SocialCredentialsRepo — Twitter round trip (tenant-scoped)", () => {
  it("encrypts all 4 fields on write, stamps the tenant_id, and decrypts on read", async () => {
    const { repo, fake } = makeRepoWithCipher();

    await repo.upsertTwitter({
      apiKey: "k1",
      apiSecret: "s1",
      accessToken: "t1",
      accessTokenSecret: "ts1",
    });

    const row = fake.rows.get("twitter");
    if (!row) throw new Error("expected twitter row to be present");
    const fields = row.encryptedFields;
    expect(fields.apiKey.ct).not.toBe("k1");
    expect(fields.apiSecret.ct).not.toBe("s1");
    expect(fields.accessToken.ct).not.toBe("t1");
    expect(fields.accessTokenSecret.ct).not.toBe("ts1");
    // Write-side tenant stamping: the insert carries the scope's tenant_id
    // (composite PK — REQ-083).
    expect(fake.lastInsertValues.value?.tenantId).toBe(TENANT_A);

    const got = await repo.getTwitter();
    expect(got).toEqual({
      apiKey: "k1",
      apiSecret: "s1",
      accessToken: "t1",
      accessTokenSecret: "ts1",
      updatedAt: expect.any(Date),
    });
  });

  it("upsertTwitter throws when no concrete tenant scope is provided (PK requires tenant_id)", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const fake = makeFakeDb();
    const unscoped = createSocialCredentialsRepo(fake.db, getCredentialCipher(env));
    await expect(
      unscoped.upsertTwitter({
        apiKey: "k",
        apiSecret: "s",
        accessToken: "t",
        accessTokenSecret: "ts",
      }),
    ).rejects.toThrow(/concrete tenant scope/);
  });
});

describe("SocialCredentialsRepo — get returns null for missing rows", () => {
  it("getTwitter returns null when no row exists", async () => {
    const { repo } = makeRepoWithCipher();
    expect(await repo.getTwitter()).toBeNull();
  });
});

describe("SocialCredentialsRepo — delete", () => {
  it("returns true when row existed, false otherwise", async () => {
    const { repo } = makeRepoWithCipher();
    await repo.upsertTwitter({
      apiKey: "k",
      apiSecret: "s",
      accessToken: "t",
      accessTokenSecret: "ts",
    });
    expect(await repo.delete("twitter")).toBe(true);
    expect(await repo.delete("twitter")).toBe(false);
  });
});

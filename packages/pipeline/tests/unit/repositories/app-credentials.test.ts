/**
 * App-level credentials repo (P12, REQ-082/086): the shared LinkedIn OAuth
 * client and the Twitter collector cookie live in `app_credentials` —
 * encrypted at rest, no tenant scoping (one row per key, shared by every
 * tenant), written only via super-admin surfaces.
 */
import { describe, it, expect, vi } from "vitest";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  createAppCredentialsRepo,
  type AppCredentialsRepo,
} from "@pipeline/repositories/app-credentials.js";
import type { AppDb, AppCredentialKey } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterCollectorEncryptedFields,
} from "@newsletter/shared/db";

interface FakeRow {
  key: AppCredentialKey;
  encryptedFields: LinkedInEncryptedFields | TwitterCollectorEncryptedFields;
  metadata: { apiVersion?: string } | null;
  updatedAt: Date;
  updatedBy?: string | null;
}

function extractKeyFromPredicate(predicate: unknown): AppCredentialKey | null {
  if (predicate === "linkedin_client" || predicate === "twitter_collector") {
    return predicate;
  }
  if (predicate === null || typeof predicate !== "object") return null;
  if ("value" in predicate) {
    const v = (predicate as { value: unknown }).value;
    if (v === "linkedin_client" || v === "twitter_collector") return v;
  }
  if ("queryChunks" in predicate) {
    for (const chunk of (predicate as { queryChunks: unknown[] }).queryChunks) {
      const found = extractKeyFromPredicate(chunk);
      if (found !== null) return found;
    }
  }
  return null;
}

function makeFakeDb(initial: FakeRow[] = []): {
  rows: Map<AppCredentialKey, FakeRow>;
  db: Pick<AppDb, "select" | "insert">;
} {
  const rows = new Map<AppCredentialKey, FakeRow>();
  for (const r of initial) rows.set(r.key, r);

  let pendingFilter: AppCredentialKey | null = null;
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(function whereImpl(this: unknown, predicate: unknown) {
      pendingFilter = extractKeyFromPredicate(predicate);
      return selectChain;
    }),
    limit: vi.fn(function limitImpl(this: unknown) {
      const key = pendingFilter;
      pendingFilter = null;
      if (key === null) return Promise.resolve([...rows.values()]);
      const row = rows.get(key);
      return Promise.resolve(row ? [row] : []);
    }),
  };
  const insertChain = {
    values: vi.fn(function valuesImpl(this: unknown, v: FakeRow) {
      return {
        onConflictDoUpdate: vi.fn(function onConflictImpl(this: unknown, conf: { set: Partial<FakeRow> }) {
          const existing = rows.get(v.key);
          if (existing) {
            rows.set(v.key, { ...existing, ...conf.set });
          } else {
            rows.set(v.key, v);
          }
          return Promise.resolve(undefined);
        }),
      };
    }),
  };

  const db = {
    select: vi.fn(() => selectChain),
    insert: vi.fn(() => insertChain),
  } as unknown as Pick<AppDb, "select" | "insert">;

  return { rows, db };
}

function makeRepo(initial: FakeRow[] = []): {
  repo: AppCredentialsRepo;
  rows: Map<AppCredentialKey, FakeRow>;
} {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  const fake = makeFakeDb(initial);
  return { repo: createAppCredentialsRepo(fake.db, getCredentialCipher(env)), rows: fake.rows };
}

const cipherEnv: NodeJS.ProcessEnv = {
  ...process.env,
  SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
};
const cipher = getCredentialCipher(cipherEnv);

describe("AppCredentialsRepo — LinkedIn client", () => {
  it("decrypts the stored client id/secret and surfaces apiVersion metadata", async () => {
    const { repo } = makeRepo([
      {
        key: "linkedin_client",
        encryptedFields: {
          clientId: cipher.encrypt("app-client-id"),
          clientSecret: cipher.encrypt("app-client-secret"),
        },
        metadata: { apiVersion: "202511" },
        updatedAt: new Date(),
      },
    ]);
    const got = await repo.getLinkedInClient();
    expect(got).toEqual({
      clientId: "app-client-id",
      clientSecret: "app-client-secret",
      apiVersion: "202511",
      updatedAt: expect.any(Date),
    });
  });

  it("returns null when no linkedin_client row exists", async () => {
    const { repo } = makeRepo();
    expect(await repo.getLinkedInClient()).toBeNull();
  });
});

describe("AppCredentialsRepo — Twitter collector cookie", () => {
  it("round-trips the cookie through upsertTwitterCollector (CSRF write-back) with ciphertext at rest", async () => {
    const { repo, rows } = makeRepo();
    await repo.upsertTwitterCollector({ apiKey: "rotated-cookie" });

    const row = rows.get("twitter_collector");
    if (!row) throw new Error("expected twitter_collector row");
    const fields = row.encryptedFields as TwitterCollectorEncryptedFields;
    expect(fields.apiKey.ct).not.toBe("rotated-cookie");

    const got = await repo.getTwitterCollector();
    expect(got).toEqual({ apiKey: "rotated-cookie", updatedAt: expect.any(Date) });
  });

  it("returns null when no twitter_collector row exists", async () => {
    const { repo } = makeRepo();
    expect(await repo.getTwitterCollector()).toBeNull();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { getCredentialCipher, type CredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import { createSuperAppCredentialsRouter } from "../super-app-credentials.js";
import type { AppCredentialsRepo, AppCredentialsStatus } from "../../repositories/app-credentials.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";

// ── In-memory app credentials repo ─────────────────────────────────────────

interface InMemoryAppRow {
  platform: "linkedin" | "twitter_collector";
  encryptedFields: Record<string, EncryptedBlob>;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
}

function makeAppCredentialsRepo(cipher: CredentialCipher): {
  repo: AppCredentialsRepo;
  rows: Map<string, InMemoryAppRow>;
} {
  const rows = new Map<string, InMemoryAppRow>();

  const repo: AppCredentialsRepo = {
    async getStatus(): Promise<AppCredentialsStatus> {
      const linkedin = rows.get("linkedin");
      const tc = rows.get("twitter_collector");
      return {
        linkedin: linkedin
          ? { configured: true, updatedAt: linkedin.updatedAt.toISOString() }
          : { configured: false, updatedAt: null },
        twitterCollector: tc
          ? { configured: true, updatedAt: tc.updatedAt.toISOString() }
          : { configured: false, updatedAt: null },
      };
    },

    async getLinkedIn() {
      const row = rows.get("linkedin");
      if (!row) return null;
      return {
        clientId: cipher.decrypt(row.encryptedFields.clientId),
        clientSecret: cipher.decrypt(row.encryptedFields.clientSecret),
        apiVersion: row.metadata?.apiVersion as string | null ?? null,
        updatedAt: row.updatedAt,
      };
    },

    async getTwitterCollector() {
      const row = rows.get("twitter_collector");
      if (!row) return null;
      return {
        apiKey: cipher.decrypt(row.encryptedFields.apiKey),
        updatedAt: row.updatedAt,
      };
    },

    async upsertLinkedIn(input): Promise<{ updatedAt: string }> {
      const now = new Date();
      rows.set("linkedin", {
        platform: "linkedin",
        encryptedFields: {
          clientId: cipher.encrypt(input.clientId),
          clientSecret: cipher.encrypt(input.clientSecret),
        },
        metadata: input.apiVersion ? { apiVersion: input.apiVersion } : null,
        updatedAt: now,
      });
      return { updatedAt: now.toISOString() };
    },

    async upsertTwitterCollector(input): Promise<{ updatedAt: string }> {
      const now = new Date();
      rows.set("twitter_collector", {
        platform: "twitter_collector",
        encryptedFields: { apiKey: cipher.encrypt(input.apiKey) },
        metadata: null,
        updatedAt: now,
      });
      return { updatedAt: now.toISOString() };
    },

    async delete(platform): Promise<boolean> {
      return rows.delete(platform);
    },
  };

  return { repo, rows };
}

// ── Router helper (no auth middleware in this test — the route is tested in isolation) ──

function makeApp(getRepo: () => AppCredentialsRepo) {
  return createSuperAppCredentialsRouter({ getRepo });
}

let cipher: CredentialCipher;
beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
  cipher = getCredentialCipher(process.env);
});

describe("super-app-credentials router — VS-12.2: GET status", () => {
  it("returns all configured:false when no rows exist", async () => {
    const { repo } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json() as AppCredentialsStatus;
    expect(body.linkedin.configured).toBe(false);
    expect(body.twitterCollector.configured).toBe(false);
  });
});

describe("super-app-credentials router — VS-12.3: secrets never leak", () => {
  it("GET returns configured boolean, never plaintext secrets", async () => {
    const { repo } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);

    // Upsert LinkedIn
    await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "super-secret-ci", clientSecret: "super-secret-cs" }),
    });

    const res = await app.request("/");
    const body = await res.json();
    const stringified = JSON.stringify(body);
    expect(stringified).not.toContain("super-secret-ci");
    expect(stringified).not.toContain("super-secret-cs");
    expect((body as AppCredentialsStatus).linkedin.configured).toBe(true);
  });
});

describe("super-app-credentials router — VS-12.4: encryption at rest", () => {
  it("stores LinkedIn fields as ciphertext", async () => {
    const { repo, rows } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);
    await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "my-ci", clientSecret: "my-cs" }),
    });

    const stored = rows.get("linkedin");
    if (!stored) throw new Error("expected linkedin row");
    expect(stored.encryptedFields.clientId.ct).not.toContain("my-ci");
    expect(cipher.decrypt(stored.encryptedFields.clientId)).toBe("my-ci");
  });

  it("stores twitter-collector fields as ciphertext", async () => {
    const { repo, rows } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);
    await app.request("/twitter-collector", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "cookie-blob" }),
    });

    const stored = rows.get("twitter_collector");
    if (!stored) throw new Error("expected twitter_collector row");
    expect(stored.encryptedFields.apiKey.ct).not.toContain("cookie-blob");
    expect(cipher.decrypt(stored.encryptedFields.apiKey)).toBe("cookie-blob");
  });
});

describe("super-app-credentials router — VS-12.5: CRUD lifecycle", () => {
  it("PUT then DELETE then GET shows configured:false", async () => {
    const { repo } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);

    await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "ci", clientSecret: "cs" }),
    });

    const del = await app.request("/linkedin", { method: "DELETE" });
    expect(await del.json()).toEqual({ ok: true, removed: true });

    const res = await app.request("/");
    const status = await res.json() as AppCredentialsStatus;
    expect(status.linkedin.configured).toBe(false);
  });

  it("DELETE with invalid platform → 400", async () => {
    const { repo } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);
    const res = await app.request("/facebook", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("PUT /linkedin with empty fields → 400", async () => {
    const { repo } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);
    const res = await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "", clientSecret: "ok" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /twitter-collector with empty apiKey → 400", async () => {
    const { repo } = makeAppCredentialsRepo(cipher);
    const app = makeApp(() => repo);
    const res = await app.request("/twitter-collector", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

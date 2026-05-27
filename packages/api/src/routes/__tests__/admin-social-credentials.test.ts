import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createAdminSocialCredentialsRouter } from "../admin-social-credentials.js";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type {
  CredentialCipher,
  EncryptedBlob,
} from "@newsletter/shared/services/credential-cipher";
import type {
  SocialCredentialsRepo,
  SocialCredentialsStatus,
  SocialCredentialPlatform,
  LinkedInUpsertInput,
  TwitterUpsertInput,
  TwitterCollectorUpsertInput,
} from "../../repositories/social-credentials.js";

interface LinkedInEncryptedFields {
  clientId: EncryptedBlob;
  clientSecret: EncryptedBlob;
}

interface TwitterEncryptedFields {
  apiKey: EncryptedBlob;
  apiSecret: EncryptedBlob;
  accessToken: EncryptedBlob;
  accessTokenSecret: EncryptedBlob;
}

interface TwitterCollectorEncryptedFields {
  apiKey: EncryptedBlob;
}

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";

interface InMemoryRow {
  platform: SocialCredentialPlatform;
  encryptedFields:
    | LinkedInEncryptedFields
    | TwitterEncryptedFields
    | TwitterCollectorEncryptedFields;
  metadata: { apiVersion?: string } | null;
  updatedAt: Date;
}

function makeInMemoryRepo(cipher: CredentialCipher): {
  repo: SocialCredentialsRepo;
  rows: Map<SocialCredentialPlatform, InMemoryRow>;
} {
  const rows = new Map<SocialCredentialPlatform, InMemoryRow>();
  const repo: SocialCredentialsRepo = {
    getLinkedIn(): Promise<import("../../repositories/social-credentials.js").LinkedInCredentialRecord | null> {
      const row = rows.get("linkedin");
      if (!row) return Promise.resolve(null);
      const fields = row.encryptedFields as LinkedInEncryptedFields;
      return Promise.resolve({
        clientId: cipher.decrypt(fields.clientId),
        clientSecret: cipher.decrypt(fields.clientSecret),
        apiVersion: row.metadata?.apiVersion ?? null,
        updatedAt: row.updatedAt,
      });
    },
    getStatus(): Promise<SocialCredentialsStatus> {
      const linkedin = rows.get("linkedin");
      const twitter = rows.get("twitter");
      const twitterCollector = rows.get("twitter_collector");
      return Promise.resolve({
        linkedin: linkedin
          ? {
              configured: true,
              apiVersion: linkedin.metadata?.apiVersion ?? null,
              updatedAt: linkedin.updatedAt.toISOString(),
            }
          : { configured: false, apiVersion: null, updatedAt: null },
        twitter: twitter
          ? { configured: true, updatedAt: twitter.updatedAt.toISOString() }
          : { configured: false, updatedAt: null },
        twitterCollector: twitterCollector
          ? {
              configured: true,
              updatedAt: twitterCollector.updatedAt.toISOString(),
            }
          : { configured: false, updatedAt: null },
      });
    },
    upsertLinkedIn(input: LinkedInUpsertInput): Promise<{ updatedAt: string }> {
      const updatedAt = new Date();
      const encryptedFields: LinkedInEncryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const metadata = input.apiVersion
        ? { apiVersion: input.apiVersion }
        : null;
      rows.set("linkedin", {
        platform: "linkedin",
        encryptedFields,
        metadata,
        updatedAt,
      });
      return Promise.resolve({ updatedAt: updatedAt.toISOString() });
    },
    upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }> {
      const updatedAt = new Date();
      const encryptedFields: TwitterEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
        apiSecret: cipher.encrypt(input.apiSecret),
        accessToken: cipher.encrypt(input.accessToken),
        accessTokenSecret: cipher.encrypt(input.accessTokenSecret),
      };
      rows.set("twitter", {
        platform: "twitter",
        encryptedFields,
        metadata: null,
        updatedAt,
      });
      return Promise.resolve({ updatedAt: updatedAt.toISOString() });
    },
    upsertTwitterCollector(
      input: TwitterCollectorUpsertInput,
    ): Promise<{ updatedAt: string }> {
      const updatedAt = new Date();
      const encryptedFields: TwitterCollectorEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
      };
      rows.set("twitter_collector", {
        platform: "twitter_collector",
        encryptedFields,
        metadata: null,
        updatedAt,
      });
      return Promise.resolve({ updatedAt: updatedAt.toISOString() });
    },
    delete(platform: SocialCredentialPlatform): Promise<boolean> {
      return Promise.resolve(rows.delete(platform));
    },
  };
  return { repo, rows };
}

function buildProtectedApp(repo: SocialCredentialsRepo): Hono {
  const app = new Hono();
  app.use("/api/admin/social-credentials/*", requireAdmin(SESSION_SECRET));
  app.use("/api/admin/social-credentials", requireAdmin(SESSION_SECRET));
  app.route(
    "/api/admin/social-credentials",
    createAdminSocialCredentialsRouter({ getRepo: () => repo }),
  );
  return app;
}

function authCookie(): string {
  const token = issueToken(SESSION_SECRET);
  return `${COOKIE_NAME}=${token}`;
}

let cipher: CredentialCipher;
beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
  cipher = getCredentialCipher(process.env);
});

describe("admin-social-credentials router — VS-6: auth gating", () => {
  it("GET without cookie → 401", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials");
    expect(res.status).toBe(401);
  });

  it("PUT /linkedin without cookie → 401", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "a", clientSecret: "b" }),
    });
    expect(res.status).toBe(401);
  });

  it("PUT /twitter without cookie → 401", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/twitter", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "k",
        apiSecret: "s",
        accessToken: "t",
        accessTokenSecret: "ts",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /:platform without cookie → 401", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});

describe("admin-social-credentials router — VS-7: GET hides secrets", () => {
  it("after PUT LinkedIn, GET returns status without plaintext secrets", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);

    const putRes = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({
        clientId: "abc-secret",
        clientSecret: "xyz-secret",
        apiVersion: "202511",
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      ok: boolean;
      configured: boolean;
      updatedAt: string;
    };
    expect(putBody.ok).toBe(true);
    expect(putBody.configured).toBe(true);
    expect(typeof putBody.updatedAt).toBe("string");

    const getRes = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as SocialCredentialsStatus;
    const stringified = JSON.stringify(body);
    expect(stringified).not.toContain("abc-secret");
    expect(stringified).not.toContain("xyz-secret");
    expect(body).toEqual({
      linkedin: {
        configured: true,
        apiVersion: "202511",
        updatedAt: expect.any(String) as unknown,
      },
      twitter: { configured: false, updatedAt: null },
      twitterCollector: { configured: false, updatedAt: null },
    });
  });
});

describe("admin-social-credentials router — VS-8: PUT validation", () => {
  it("LinkedIn PUT with empty clientSecret → 400", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({ clientId: "abc", clientSecret: "", apiVersion: "v" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown };
    expect(body.error).toBeDefined();
    expect(body.issues).toBeDefined();
  });

  it("LinkedIn PUT with whitespace-only clientId → 400", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({ clientId: "   ", clientSecret: "ok" }),
    });
    expect(res.status).toBe(400);
  });

  it("Twitter PUT missing accessToken → 400", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/twitter", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({
        apiKey: "k",
        apiSecret: "s",
        accessTokenSecret: "ts",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("Twitter PUT with whitespace-only apiSecret → 400", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/twitter", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({
        apiKey: "k",
        apiSecret: "  ",
        accessToken: "t",
        accessTokenSecret: "ts",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("admin-social-credentials router — VS-9: stored row is encrypted", () => {
  it("after PUT, stored row contains encrypted blob (not plaintext)", async () => {
    const { repo, rows } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({
        clientId: "abc-secret",
        clientSecret: "xyz-secret",
        apiVersion: "202511",
      }),
    });
    expect(res.status).toBe(200);

    const stored = rows.get("linkedin");
    expect(stored).toBeDefined();
    const encryptedFields = stored?.encryptedFields as LinkedInEncryptedFields;
    expect(encryptedFields.clientId.ct).not.toBe("abc-secret");
    expect(encryptedFields.clientSecret.ct).not.toBe("xyz-secret");
    expect(encryptedFields.clientId.iv).toMatch(/.+/);
    expect(encryptedFields.clientId.tag).toMatch(/.+/);

    // Round-trip: decrypting reproduces the plaintext.
    const decrypted = cipher.decrypt(encryptedFields.clientId);
    expect(decrypted).toBe("abc-secret");
  });
});

describe("admin-social-credentials router — VS-10: DELETE", () => {
  it("PUT then DELETE returns removed:true; second DELETE returns removed:false; GET shows configured:false", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);

    await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify({
        clientId: "abc-secret",
        clientSecret: "xyz-secret",
        apiVersion: "202511",
      }),
    });

    const del1 = await app.request("/api/admin/social-credentials/linkedin", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(del1.status).toBe(200);
    expect(await del1.json()).toEqual({ ok: true, removed: true });

    const del2 = await app.request("/api/admin/social-credentials/linkedin", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(del2.status).toBe(200);
    expect(await del2.json()).toEqual({ ok: true, removed: false });

    const getRes = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    const body = (await getRes.json()) as {
      linkedin: { configured: boolean };
    };
    expect(body.linkedin.configured).toBe(false);
  });

  it("DELETE with invalid :platform → 400", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/facebook", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });
});

describe("admin-social-credentials router — twitter-collector (REQ-004)", () => {
  it("PUT /twitter-collector persists the cookie blob and GET reports configured:true", async () => {
    const { repo, rows } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);

    const put = await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "base64-cookie-blob" }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { ok: boolean; configured: boolean };
    expect(body).toMatchObject({ ok: true, configured: true });
    expect(rows.has("twitter_collector")).toBe(true);

    const get = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    const status = (await get.json()) as {
      twitterCollector: { configured: boolean; updatedAt: string | null };
    };
    expect(status.twitterCollector.configured).toBe(true);
    expect(status.twitterCollector.updatedAt).not.toBeNull();
  });

  it("PUT /twitter-collector with empty apiKey → 400", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT then DELETE /twitter-collector removes the row", async () => {
    const { repo, rows } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "blob" }),
    });
    expect(rows.has("twitter_collector")).toBe(true);

    const del = await app.request(
      "/api/admin/social-credentials/twitter-collector",
      {
        method: "DELETE",
        headers: { cookie: authCookie() },
      },
    );
    expect(del.status).toBe(200);
    expect((await del.json()) as { removed: boolean }).toEqual({
      ok: true,
      removed: true,
    });
    expect(rows.has("twitter_collector")).toBe(false);
  });

  it("PUT /twitter-collector without cookie → 401", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "blob" }),
    });
    expect(res.status).toBe(401);
  });

  it("stored row holds an encrypted blob (not plaintext)", async () => {
    const { repo, rows } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "plaintext-cookie-blob" }),
    });
    const row = rows.get("twitter_collector");
    if (row === undefined) {
      throw new Error("expected row to exist after PUT");
    }
    const fields = row.encryptedFields as TwitterCollectorEncryptedFields;
    expect(fields.apiKey.ct).not.toContain("plaintext-cookie-blob");
    expect(cipher.decrypt(fields.apiKey)).toBe("plaintext-cookie-blob");
  });
});

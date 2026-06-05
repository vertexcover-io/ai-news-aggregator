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

interface RequestCase {
  readonly name: string;
  readonly path: string;
  readonly init?: { method: string; body?: string };
}

describe("admin-social-credentials router — VS-6: auth gating", () => {
  it.each<RequestCase>([
    { name: "GET status", path: "/api/admin/social-credentials" },
    {
      name: "PUT /linkedin",
      path: "/api/admin/social-credentials/linkedin",
      init: { method: "PUT", body: JSON.stringify({ clientId: "a", clientSecret: "b" }) },
    },
    {
      name: "PUT /twitter",
      path: "/api/admin/social-credentials/twitter",
      init: {
        method: "PUT",
        body: JSON.stringify({
          apiKey: "k",
          apiSecret: "s",
          accessToken: "t",
          accessTokenSecret: "ts",
        }),
      },
    },
    {
      name: "DELETE /:platform",
      path: "/api/admin/social-credentials/linkedin",
      init: { method: "DELETE" },
    },
  ])("$name without cookie → 401", async ({ path, init }) => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request(path, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json" },
      ...(init?.body === undefined ? {} : { body: init.body }),
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
  it.each<{ name: string; path: string; body: Record<string, unknown> }>([
    {
      name: "LinkedIn with empty clientSecret",
      path: "/api/admin/social-credentials/linkedin",
      body: { clientId: "abc", clientSecret: "", apiVersion: "v" },
    },
    {
      name: "LinkedIn with whitespace-only clientId",
      path: "/api/admin/social-credentials/linkedin",
      body: { clientId: "   ", clientSecret: "ok" },
    },
    {
      name: "Twitter missing accessToken",
      path: "/api/admin/social-credentials/twitter",
      body: { apiKey: "k", apiSecret: "s", accessTokenSecret: "ts" },
    },
    {
      name: "Twitter with whitespace-only apiSecret",
      path: "/api/admin/social-credentials/twitter",
      body: { apiKey: "k", apiSecret: "  ", accessToken: "t", accessTokenSecret: "ts" },
    },
  ])("PUT $name → 400 with error + issues", async ({ path, body }) => {
    const { repo } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request(path, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: string; issues: unknown };
    expect(resBody.error).toBeDefined();
    expect(resBody.issues).toBeDefined();
  });
});

interface EncryptionCase {
  readonly name: string;
  readonly platform: SocialCredentialPlatform;
  readonly path: string;
  readonly body: Record<string, unknown>;
  /** Plaintext secret to verify never appears in ciphertext + round-trips. */
  readonly secret: string;
  /** Pull the encrypted blob for `secret` out of the stored row. */
  readonly blobOf: (fields: InMemoryRow["encryptedFields"]) => EncryptedBlob;
}

describe("admin-social-credentials router — VS-9: stored row is encrypted", () => {
  it.each<EncryptionCase>([
    {
      name: "LinkedIn clientId",
      platform: "linkedin",
      path: "/api/admin/social-credentials/linkedin",
      body: { clientId: "abc-secret", clientSecret: "xyz-secret", apiVersion: "202511" },
      secret: "abc-secret",
      blobOf: (f) => (f as LinkedInEncryptedFields).clientId,
    },
    {
      name: "twitter-collector apiKey cookie blob",
      platform: "twitter_collector",
      path: "/api/admin/social-credentials/twitter-collector",
      body: { apiKey: "plaintext-cookie-blob" },
      secret: "plaintext-cookie-blob",
      blobOf: (f) => (f as TwitterCollectorEncryptedFields).apiKey,
    },
  ])("after PUT, $name is stored as ciphertext and round-trips", async ({
    platform,
    path,
    body,
    secret,
    blobOf,
  }) => {
    const { repo, rows } = makeInMemoryRepo(cipher);
    const app = buildProtectedApp(repo);
    const res = await app.request(path, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: authCookie() },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);

    const stored = rows.get(platform);
    if (stored === undefined) {
      throw new Error(`expected ${platform} row to exist after PUT`);
    }
    const blob = blobOf(stored.encryptedFields);
    expect(blob.ct).not.toContain(secret);
    expect(blob.iv).toMatch(/.+/);
    expect(blob.tag).toMatch(/.+/);
    // Round-trip: decrypting reproduces the plaintext.
    expect(cipher.decrypt(blob)).toBe(secret);
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

  it("DELETE /linkedin also clears the OAuth token row (not just client creds)", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    // Minimal in-memory token repo tracking deleteToken calls.
    let linkedinTokenExists = true;
    const deletedPlatforms: string[] = [];
    const tokenRepo = {
      saveToken: (): Promise<void> => Promise.resolve(),
      getLinkedIn: (): Promise<null> => Promise.resolve(null),
      deleteToken: (platform: "linkedin" | "twitter"): Promise<boolean> => {
        deletedPlatforms.push(platform);
        const existed = platform === "linkedin" && linkedinTokenExists;
        if (platform === "linkedin") linkedinTokenExists = false;
        return Promise.resolve(existed);
      },
    };
    const app = new Hono();
    app.use("/api/admin/social-credentials/*", requireAdmin(SESSION_SECRET));
    app.route(
      "/api/admin/social-credentials",
      createAdminSocialCredentialsRouter({
        getRepo: () => repo,
        getTokenRepo: () => tokenRepo,
      }),
    );

    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
    // The token deletion was invoked for linkedin.
    expect(deletedPlatforms).toEqual(["linkedin"]);
    expect(linkedinTokenExists).toBe(false);
  });

  it("DELETE /twitter does NOT clear the linkedin OAuth token", async () => {
    const { repo } = makeInMemoryRepo(cipher);
    const deletedPlatforms: string[] = [];
    const tokenRepo = {
      saveToken: (): Promise<void> => Promise.resolve(),
      getLinkedIn: (): Promise<null> => Promise.resolve(null),
      deleteToken: (platform: "linkedin" | "twitter"): Promise<boolean> => {
        deletedPlatforms.push(platform);
        return Promise.resolve(false);
      },
    };
    const app = new Hono();
    app.use("/api/admin/social-credentials/*", requireAdmin(SESSION_SECRET));
    app.route(
      "/api/admin/social-credentials",
      createAdminSocialCredentialsRouter({
        getRepo: () => repo,
        getTokenRepo: () => tokenRepo,
      }),
    );

    await app.request("/api/admin/social-credentials/twitter", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    // Twitter has no OAuth token row in this feature; deleteToken must not fire.
    expect(deletedPlatforms).toEqual([]);
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

  // The twitter-collector encryption-at-rest case is covered alongside LinkedIn
  // in the VS-9 parameterized table above.
});

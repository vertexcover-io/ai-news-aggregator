import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { APP_CREDENTIALS_TENANT_ID } from "@newsletter/shared/constants";
import { createAdminSocialCredentialsRouter } from "../admin-social-credentials.js";
import { requireUser } from "../../auth/middleware.js";
import { issueSession, COOKIE_NAME } from "../../auth/session.js";
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
  TwitterCollectorUpsertInput,
} from "../../repositories/social-credentials.js";

interface LinkedInEncryptedFields {
  clientId: EncryptedBlob;
  clientSecret: EncryptedBlob;
}

interface TwitterCollectorEncryptedFields {
  apiKey: EncryptedBlob;
}

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const TENANT_A = "tenant-a";

interface InMemoryRow {
  platform: SocialCredentialPlatform;
  encryptedFields: LinkedInEncryptedFields | TwitterCollectorEncryptedFields;
  metadata: { apiVersion?: string } | null;
  updatedAt: Date;
}

/** Per-tenant in-memory store keyed by (tenantId, platform). */
function makeInMemoryStores(cipher: CredentialCipher): {
  getRepo: (tenantId: string) => SocialCredentialsRepo;
  rowsFor: (tenantId: string) => Map<SocialCredentialPlatform, InMemoryRow>;
} {
  const stores = new Map<string, Map<SocialCredentialPlatform, InMemoryRow>>();
  const rowsFor = (
    tenantId: string,
  ): Map<SocialCredentialPlatform, InMemoryRow> => {
    let store = stores.get(tenantId);
    if (!store) {
      store = new Map();
      stores.set(tenantId, store);
    }
    return store;
  };

  const getRepo = (tenantId: string): SocialCredentialsRepo => {
    const rows = rowsFor(tenantId);
    return {
      getLinkedIn() {
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
        rows.set("linkedin", {
          platform: "linkedin",
          encryptedFields: {
            clientId: cipher.encrypt(input.clientId),
            clientSecret: cipher.encrypt(input.clientSecret),
          },
          metadata: input.apiVersion ? { apiVersion: input.apiVersion } : null,
          updatedAt,
        });
        return Promise.resolve({ updatedAt: updatedAt.toISOString() });
      },
      upsertTwitterCollector(
        input: TwitterCollectorUpsertInput,
      ): Promise<{ updatedAt: string }> {
        const updatedAt = new Date();
        rows.set("twitter_collector", {
          platform: "twitter_collector",
          encryptedFields: { apiKey: cipher.encrypt(input.apiKey) },
          metadata: null,
          updatedAt,
        });
        return Promise.resolve({ updatedAt: updatedAt.toISOString() });
      },
      delete(platform: SocialCredentialPlatform): Promise<boolean> {
        return Promise.resolve(rows.delete(platform));
      },
    };
  };

  return { getRepo, rowsFor };
}

function buildProtectedApp(
  getRepo: (tenantId: string) => SocialCredentialsRepo,
): Hono {
  const app = new Hono();
  app.use("/api/admin/social-credentials/*", requireUser(SESSION_SECRET));
  app.use("/api/admin/social-credentials", requireUser(SESSION_SECRET));
  app.route(
    "/api/admin/social-credentials",
    createAdminSocialCredentialsRouter({ getRepo, sessionSecret: SESSION_SECRET }),
  );
  return app;
}

function tenantCookie(): string {
  const token = issueSession(
    { uid: "test-user", tid: TENANT_A, role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

function superAdminCookie(): string {
  const token = issueSession(
    { uid: "root-user", tid: null, role: "super_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

let cipher: CredentialCipher;
let stores: ReturnType<typeof makeInMemoryStores>;
let app: Hono;

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
  cipher = getCredentialCipher(process.env);
  stores = makeInMemoryStores(cipher);
  app = buildProtectedApp(stores.getRepo);
});

describe("auth gating — no cookie → 401", () => {
  it.each([
    { name: "GET status", path: "/api/admin/social-credentials", method: "GET" },
    {
      name: "PUT /linkedin",
      path: "/api/admin/social-credentials/linkedin",
      method: "PUT",
    },
    {
      name: "PUT /twitter-collector",
      path: "/api/admin/social-credentials/twitter-collector",
      method: "PUT",
    },
    {
      name: "DELETE /twitter",
      path: "/api/admin/social-credentials/twitter",
      method: "DELETE",
    },
  ])("$name", async ({ path, method }) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "PUT" ? { body: JSON.stringify({}) } : {}),
    });
    expect(res.status).toBe(401);
  });
});

describe("REQ-081/REQ-082: tenant manual Twitter API-key entry is REMOVED", () => {
  it("PUT /twitter → 404 for tenant admins and super admins alike", async () => {
    const body = JSON.stringify({
      apiKey: "k",
      apiSecret: "s",
      accessToken: "t",
      accessTokenSecret: "ts",
    });
    for (const cookie of [tenantCookie(), superAdminCookie()]) {
      const res = await app.request("/api/admin/social-credentials/twitter", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body,
      });
      expect(res.status).toBe(404);
    }
  });
});

describe("REQ-082/REQ-086: app-level secrets are super-admin only", () => {
  it.each([
    {
      name: "PUT /linkedin",
      path: "/api/admin/social-credentials/linkedin",
      method: "PUT",
      body: { clientId: "a", clientSecret: "b" },
    },
    {
      name: "PUT /twitter-collector",
      path: "/api/admin/social-credentials/twitter-collector",
      method: "PUT",
      body: { apiKey: "cookie-blob" },
    },
    {
      name: "DELETE /linkedin",
      path: "/api/admin/social-credentials/linkedin",
      method: "DELETE",
    },
    {
      name: "DELETE /twitter-collector",
      path: "/api/admin/social-credentials/twitter-collector",
      method: "DELETE",
    },
  ])("$name with a tenant-admin cookie → 403", async ({ path, method, body }) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie: tenantCookie() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(res.status).toBe(403);
  });

  it("super admin PUT /twitter-collector writes to the APP credentials store, not a tenant store", async () => {
    const res = await app.request(
      "/api/admin/social-credentials/twitter-collector",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: superAdminCookie(),
        },
        body: JSON.stringify({ apiKey: "base64-cookie-blob" }),
      },
    );
    expect(res.status).toBe(200);
    expect(
      stores.rowsFor(APP_CREDENTIALS_TENANT_ID).has("twitter_collector"),
    ).toBe(true);
    expect(stores.rowsFor(TENANT_A).has("twitter_collector")).toBe(false);
  });

  it("super admin PUT /linkedin writes the shared app client to the APP store", async () => {
    const res = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify({
        clientId: "abc-secret",
        clientSecret: "xyz-secret",
        apiVersion: "202511",
      }),
    });
    expect(res.status).toBe(200);
    expect(stores.rowsFor(APP_CREDENTIALS_TENANT_ID).has("linkedin")).toBe(true);
  });

  it("super admin DELETE /twitter-collector removes the app-store row", async () => {
    await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify({ apiKey: "blob" }),
    });

    const del = await app.request(
      "/api/admin/social-credentials/twitter-collector",
      { method: "DELETE", headers: { cookie: superAdminCookie() } },
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, removed: true });
    expect(
      stores.rowsFor(APP_CREDENTIALS_TENANT_ID).has("twitter_collector"),
    ).toBe(false);
  });
});

describe("PUT validation", () => {
  it.each([
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
      name: "twitter-collector with empty apiKey",
      path: "/api/admin/social-credentials/twitter-collector",
      body: { apiKey: "   " },
    },
  ])("PUT $name → 400 with error + issues", async ({ path, body }) => {
    const res = await app.request(path, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: string; issues: unknown };
    expect(resBody.error).toBeDefined();
    expect(resBody.issues).toBeDefined();
  });
});

describe("NF6/REQ-125: GET status hides secrets", () => {
  it("after PUTs, GET returns status without any plaintext secret material", async () => {
    await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify({
        clientId: "abc-secret",
        clientSecret: "xyz-secret",
        apiVersion: "202511",
      }),
    });
    await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify({ apiKey: "plaintext-cookie-blob" }),
    });

    // Scanned from a TENANT admin's perspective (REQ-082 acceptance).
    const getRes = await app.request("/api/admin/social-credentials", {
      headers: { cookie: tenantCookie() },
    });
    expect(getRes.status).toBe(200);
    const raw = await getRes.text();
    expect(raw).not.toContain("abc-secret");
    expect(raw).not.toContain("xyz-secret");
    expect(raw).not.toContain("plaintext-cookie-blob");

    const body = JSON.parse(raw) as SocialCredentialsStatus;
    expect(body).toEqual({
      linkedin: {
        configured: true,
        apiVersion: "202511",
        updatedAt: expect.any(String) as unknown,
      },
      twitter: { configured: false, updatedAt: null },
      twitterCollector: {
        configured: true,
        updatedAt: expect.any(String) as unknown,
      },
    });
  });

  it("app-level rows are visible as configured flags from any tenant (shared client), never as values", async () => {
    await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify({ apiKey: "blob" }),
    });

    const res = await app.request("/api/admin/social-credentials", {
      headers: { cookie: tenantCookie() },
    });
    const body = (await res.json()) as SocialCredentialsStatus;
    expect(body.twitterCollector.configured).toBe(true);
  });
});

describe("encryption at rest", () => {
  it("after super-admin PUT, stored blobs are ciphertext and round-trip", async () => {
    await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: superAdminCookie(),
      },
      body: JSON.stringify({ apiKey: "plaintext-cookie-blob" }),
    });

    const stored = stores
      .rowsFor(APP_CREDENTIALS_TENANT_ID)
      .get("twitter_collector");
    if (stored === undefined) throw new Error("expected collector row");
    const blob = (stored.encryptedFields as TwitterCollectorEncryptedFields)
      .apiKey;
    expect(blob.ct).not.toContain("plaintext-cookie-blob");
    expect(blob.iv).toMatch(/.+/);
    expect(blob.tag).toMatch(/.+/);
    expect(cipher.decrypt(blob)).toBe("plaintext-cookie-blob");
  });
});

describe("DELETE", () => {
  it("tenant DELETE /twitter clears the tenant's legacy manual creds row", async () => {
    stores.rowsFor(TENANT_A).set("twitter", {
      platform: "twitter",
      encryptedFields: { apiKey: cipher.encrypt("k") },
      metadata: null,
      updatedAt: new Date(),
    });

    const del1 = await app.request("/api/admin/social-credentials/twitter", {
      method: "DELETE",
      headers: { cookie: tenantCookie() },
    });
    expect(del1.status).toBe(200);
    expect(await del1.json()).toEqual({ ok: true, removed: true });

    const del2 = await app.request("/api/admin/social-credentials/twitter", {
      method: "DELETE",
      headers: { cookie: tenantCookie() },
    });
    expect(await del2.json()).toEqual({ ok: true, removed: false });
  });

  it("DELETE with invalid :platform → 400", async () => {
    const res = await app.request("/api/admin/social-credentials/facebook", {
      method: "DELETE",
      headers: { cookie: tenantCookie() },
    });
    expect(res.status).toBe(400);
  });
});

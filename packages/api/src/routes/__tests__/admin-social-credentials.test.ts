/**
 * Tenant-facing social credentials routes (P12, REQ-080/082/086):
 *  - tenants manage ONLY their own Twitter posting keys + LinkedIn disconnect
 *  - app-level setters (PUT /linkedin, PUT /twitter-collector) are GONE (404)
 *  - GET / composes tenant twitter status with app-level configured flags and
 *    never serializes secret material (NF6)
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createAdminSocialCredentialsRouter } from "../admin-social-credentials.js";
import { requireAuth } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type {
  CredentialCipher,
  EncryptedBlob,
} from "@newsletter/shared/services/credential-cipher";
import type {
  SocialCredentialsRepo,
  TwitterUpsertInput,
} from "../../repositories/social-credentials.js";
import type { AppCredentialsStatus } from "../../repositories/app-credentials.js";
import type {
  SocialTokensRepo,
  SocialTokenRecord,
} from "../../repositories/social-tokens.js";

interface TwitterEncryptedFields {
  apiKey: EncryptedBlob;
  apiSecret: EncryptedBlob;
  accessToken: EncryptedBlob;
  accessTokenSecret: EncryptedBlob;
}

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";

interface InMemoryRow {
  encryptedFields: TwitterEncryptedFields;
  updatedAt: Date;
}

function makeInMemoryRepo(cipher: CredentialCipher): {
  repo: SocialCredentialsRepo;
  rows: Map<"twitter", InMemoryRow>;
} {
  const rows = new Map<"twitter", InMemoryRow>();
  const repo: SocialCredentialsRepo = {
    getStatus() {
      const twitter = rows.get("twitter");
      return Promise.resolve({
        twitter: twitter
          ? { configured: true, updatedAt: twitter.updatedAt.toISOString() }
          : { configured: false, updatedAt: null },
      });
    },
    upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }> {
      const updatedAt = new Date();
      rows.set("twitter", {
        encryptedFields: {
          apiKey: cipher.encrypt(input.apiKey),
          apiSecret: cipher.encrypt(input.apiSecret),
          accessToken: cipher.encrypt(input.accessToken),
          accessTokenSecret: cipher.encrypt(input.accessTokenSecret),
        },
        updatedAt,
      });
      return Promise.resolve({ updatedAt: updatedAt.toISOString() });
    },
    delete(platform: "twitter"): Promise<boolean> {
      return Promise.resolve(rows.delete(platform));
    },
  };
  return { repo, rows };
}

function makeTokenRepo(initial: SocialTokenRecord | null): {
  repo: SocialTokensRepo;
  state: { token: SocialTokenRecord | null };
} {
  const state = { token: initial };
  const repo: SocialTokensRepo = {
    saveToken() {
      return Promise.resolve();
    },
    getLinkedIn() {
      return Promise.resolve(state.token);
    },
    deleteToken() {
      const existed = state.token !== null;
      state.token = null;
      return Promise.resolve(existed);
    },
  };
  return { repo, state };
}

const APP_SECRET_SENTINEL = "app-level-client-secret-never-serialized";

const appStatus: AppCredentialsStatus = {
  linkedinClient: {
    configured: true,
    apiVersion: "202511",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  twitterCollector: { configured: true, updatedAt: "2026-06-02T00:00:00.000Z" },
};

function buildApp(opts?: {
  tokenRepo?: SocialTokensRepo;
  withAppRepo?: boolean;
}): { app: Hono; rows: Map<"twitter", InMemoryRow>; cipher: CredentialCipher } {
  const cipher = getCredentialCipher({
    ...process.env,
    SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  const { repo, rows } = makeInMemoryRepo(cipher);
  const tokenRepo = opts?.tokenRepo;
  const app = new Hono();
  app.use("*", requireAuth(SESSION_SECRET));
  app.route(
    "/",
    createAdminSocialCredentialsRouter({
      getRepo: () => repo,
      getTokenRepo: tokenRepo ? () => tokenRepo : undefined,
      getAppRepo:
        opts?.withAppRepo === false
          ? undefined
          : () => ({ getStatus: () => Promise.resolve(appStatus) }),
    }),
  );
  return { app, rows, cipher };
}

function authCookie(): string {
  const token = issueToken(
    { userId: "00000000-0000-4000-8000-000000000001", tenantId: "00000000-0000-4000-8000-0000000000aa", role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

const VALID_TWITTER_BODY = {
  apiKey: "k",
  apiSecret: "s",
  accessToken: "t",
  accessTokenSecret: "ts",
};

describe("admin-social-credentials router — auth gating", () => {
  it.each<{ name: string; method: string; path: string; body?: unknown }>([
    { name: "GET / without cookie", method: "GET", path: "/" },
    { name: "PUT /twitter without cookie", method: "PUT", path: "/twitter", body: VALID_TWITTER_BODY },
    { name: "DELETE /twitter without cookie", method: "DELETE", path: "/twitter" },
  ])("$name → 401", async ({ method, path, body }) => {
    const { app } = buildApp();
    const res = await app.request(path, {
      method,
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    expect(res.status).toBe(401);
  });
});

describe("admin-social-credentials router — app-level setters are gone (REQ-082)", () => {
  it.each([
    { name: "PUT /linkedin", path: "/linkedin", body: { clientId: "a", clientSecret: "b" } },
    { name: "PUT /twitter-collector", path: "/twitter-collector", body: { apiKey: "cookie" } },
  ])("$name → 404 (moved to /api/super/app-credentials)", async ({ path, body }) => {
    const { app } = buildApp();
    const res = await app.request(path, {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(404);
  });
});

describe("admin-social-credentials router — GET / status composition", () => {
  it("reports tenant twitter status + app-level configured flags, never secrets (NF6)", async () => {
    const { app } = buildApp();
    await app.request("/twitter", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ ...VALID_TWITTER_BODY, apiKey: APP_SECRET_SENTINEL }),
    });

    const res = await app.request("/", { headers: { cookie: authCookie() } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(APP_SECRET_SENTINEL);
    const body = JSON.parse(text) as {
      linkedin: { configured: boolean; apiVersion: string | null; updatedAt: string | null };
      twitter: { configured: boolean; updatedAt: string | null };
      twitterCollector: { configured: boolean; updatedAt: string | null };
    };
    expect(body.linkedin).toEqual({
      configured: true,
      apiVersion: "202511",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(body.twitter.configured).toBe(true);
    expect(body.twitterCollector).toEqual({
      configured: true,
      updatedAt: "2026-06-02T00:00:00.000Z",
    });
  });

  it("reports app-level entries as unconfigured when no getAppRepo is wired (legacy composition)", async () => {
    const { app } = buildApp({ withAppRepo: false });
    const res = await app.request("/", { headers: { cookie: authCookie() } });
    const body = (await res.json()) as {
      linkedin: { configured: boolean };
      twitterCollector: { configured: boolean };
    };
    expect(body.linkedin.configured).toBe(false);
    expect(body.twitterCollector.configured).toBe(false);
  });
});

describe("admin-social-credentials router — PUT /twitter", () => {
  it.each<{ name: string; body: Record<string, unknown> }>([
    { name: "missing apiSecret", body: { apiKey: "k", accessToken: "t", accessTokenSecret: "ts" } },
    { name: "empty accessToken", body: { ...VALID_TWITTER_BODY, accessToken: "" } },
    { name: "non-object body", body: [] as unknown as Record<string, unknown> },
  ])("rejects $name with 400", async ({ body }) => {
    const { app } = buildApp();
    const res = await app.request("/twitter", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it("stores all four fields encrypted at rest (REQ-083)", async () => {
    const { app, rows } = buildApp();
    const res = await app.request("/twitter", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify(VALID_TWITTER_BODY),
    });
    expect(res.status).toBe(200);
    const row = rows.get("twitter");
    if (!row) throw new Error("expected twitter row");
    expect(row.encryptedFields.apiKey.ct).not.toBe("k");
    expect(row.encryptedFields.apiSecret.ct).not.toBe("s");
    expect(row.encryptedFields.accessToken.ct).not.toBe("t");
    expect(row.encryptedFields.accessTokenSecret.ct).not.toBe("ts");
  });
});

describe("admin-social-credentials router — DELETE", () => {
  it("PUT then DELETE /twitter → removed:true; second DELETE → removed:false; GET shows configured:false", async () => {
    const { app } = buildApp();
    await app.request("/twitter", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify(VALID_TWITTER_BODY),
    });
    const del1 = await app.request("/twitter", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(((await del1.json()) as { removed: boolean }).removed).toBe(true);
    const del2 = await app.request("/twitter", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(((await del2.json()) as { removed: boolean }).removed).toBe(false);
    const status = await app.request("/", { headers: { cookie: authCookie() } });
    const body = (await status.json()) as { twitter: { configured: boolean } };
    expect(body.twitter.configured).toBe(false);
  });

  it("DELETE /linkedin disconnects the OAuth token (the app client is untouched, REQ-080)", async () => {
    const { repo: tokenRepo, state } = makeTokenRepo({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(),
      metadata: null,
    });
    const { app } = buildApp({ tokenRepo });
    const res = await app.request("/linkedin", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { removed: boolean }).removed).toBe(true);
    expect(state.token).toBeNull();
  });

  it("DELETE /linkedin with no token reports removed:false", async () => {
    const { repo: tokenRepo } = makeTokenRepo(null);
    const { app } = buildApp({ tokenRepo });
    const res = await app.request("/linkedin", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(((await res.json()) as { removed: boolean }).removed).toBe(false);
  });

  it("DELETE /twitter-collector → 400 (no longer a tenant platform)", async () => {
    const { app } = buildApp();
    const res = await app.request("/twitter-collector", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });

  it("DELETE with unknown :platform → 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/facebook", {
      method: "DELETE",
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });
});

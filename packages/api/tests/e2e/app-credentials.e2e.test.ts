/**
 * P12 integration: two-tier social credentials against the real DB.
 *
 * REQ-083: social credentials/tokens keyed (tenant_id, platform), ciphertext
 *          at rest — two tenants can hold the same platform concurrently.
 * REQ-080: the LinkedIn OAuth flow (shared app client from app_credentials)
 *          stores ONLY the connecting tenant's tokens.
 * REQ-082/NF6: app-level secrets (LinkedIn client secret, collector cookie)
 *          never appear in tenant-facing responses; tenants cannot write them
 *          (those setters live under /api/super/app-credentials).
 * REQ-086: the shared Twitter collector cookie is super-admin-managed and
 *          hidden from tenants while staying resolvable for collection.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

const REPO_ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import {
  getDb,
  tenants,
  socialCredentials,
  socialTokens,
  appCredentials,
} from "@newsletter/shared/db";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createAdminSocialCredentialsRouter } from "@api/routes/admin-social-credentials.js";
import { createSuperAppCredentialsRouter } from "@api/routes/super-app-credentials.js";
import {
  createLinkedInOAuthRouter,
  createLinkedInOAuthCallbackRouter,
  type LinkedInOAuthRouterDeps,
} from "@api/routes/linkedin-oauth.js";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
  type TwitterOAuthRouterDeps,
} from "@api/routes/twitter-oauth.js";
import type { TwitterOAuthProvider } from "@api/services/twitter-oauth.js";
import { createSocialCredentialsRepo } from "@api/repositories/social-credentials.js";
import { createSocialTokensRepo } from "@api/repositories/social-tokens.js";
import { createAppCredentialsRepo } from "@api/repositories/app-credentials.js";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";

const SESSION_SECRET = "p12-app-credentials-test-secret-32b!!";
const STAMP = `p12ac${Date.now().toString(36)}`;
const CLIENT_SECRET_SENTINEL = `p12-linkedin-client-secret-${STAMP}`;
const COOKIE_SENTINEL = `p12-collector-cookie-${STAMP}`;

const db = getDb();
const cipher = getCredentialCipher({ SESSION_SECRET } as NodeJS.ProcessEnv);

let tenantAId: string;
let tenantBId: string;

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const SUPER = "00000000-0000-4000-8000-00000000000f";

function tenantCookie(userId: string, tenantId: string): string {
  return `${COOKIE_NAME}=${issueToken({ userId, tenantId, role: "tenant_admin" }, SESSION_SECRET)}`;
}

function superCookie(): string {
  return `${COOKIE_NAME}=${issueToken({ userId: SUPER, tenantId: null, role: "super_admin" }, SESSION_SECRET)}`;
}

interface FakeRedis {
  store: Map<string, string>;
  set(key: string, value: string, exMode: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

function makeRedis(): FakeRedis {
  const store = new Map<string, string>();
  return {
    store,
    set(key, value) {
      store.set(key, value);
      return Promise.resolve("OK");
    },
    get(key) {
      return Promise.resolve(store.get(key) ?? null);
    },
    del(key) {
      return Promise.resolve(store.delete(key) ? 1 : 0);
    },
  };
}

/** Fake LinkedIn provider: token exchange + userinfo. */
function makeLinkedInFetch(personSub: string): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("accessToken")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: `at-${personSub}`,
            expires_in: 5184000,
            refresh_token: `rt-${personSub}`,
            refresh_token_expires_in: 31536000,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.includes("userinfo")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ sub: personSub, name: `Member ${personSub}` }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;
}

/** Fake Twitter OAuth2 provider (P13): deterministic state + token exchange. */
function makeTwitterProvider(handle: string): TwitterOAuthProvider {
  return {
    generateAuthLink() {
      return {
        url: `https://x.com/i/oauth2/authorize?state=tw-state-${handle}`,
        codeVerifier: `cv-${handle}`,
        state: `tw-state-${handle}`,
      };
    },
    exchangeCode(input) {
      // The exchange only succeeds with the PKCE verifier the start step stored.
      if (input.codeVerifier !== `cv-${handle}`) {
        return Promise.resolve({ ok: false as const });
      }
      return Promise.resolve({
        ok: true as const,
        accessToken: `tw-at-${handle}`,
        refreshToken: `tw-rt-${handle}`,
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        username: handle,
      });
    },
  };
}

function buildApp(
  redis: FakeRedis,
  fetchFn?: typeof fetch,
  twitterProvider?: TwitterOAuthProvider,
): Hono {
  const app = new Hono();

  const oauthDeps: LinkedInOAuthRouterDeps = {
    getAppCredsRepo: () => createAppCredentialsRepo(db, cipher),
    getTokenRepo: (scope) => createSocialTokensRepo(db, cipher, scope),
    redis,
    env: { ...process.env, PUBLIC_BASE_URL: "https://app.test" },
    fetchFn,
  };

  const twitterOAuthDeps: TwitterOAuthRouterDeps = {
    getAppCredsRepo: () => createAppCredentialsRepo(db, cipher),
    getTokenRepo: (scope) => createSocialTokensRepo(db, cipher, scope),
    redis,
    env: {
      ...process.env,
      PUBLIC_BASE_URL: "https://app.test",
      TWITTER_OAUTH2_CLIENT_ID: "",
      TWITTER_OAUTH2_CLIENT_SECRET: "",
    },
    provider: twitterProvider ?? makeTwitterProvider("unused"),
  };

  // Public callbacks (state-gated, no session).
  app.route(
    "/api/admin/social-credentials/linkedin/oauth/callback",
    createLinkedInOAuthCallbackRouter(oauthDeps),
  );
  app.route(
    "/api/admin/social-credentials/twitter/oauth/callback",
    createTwitterOAuthCallbackRouter(twitterOAuthDeps),
  );

  const adminApp = new Hono();
  adminApp.use("*", requireAuth(SESSION_SECRET));
  adminApp.route(
    "/social-credentials/linkedin/oauth",
    createLinkedInOAuthRouter(oauthDeps),
  );
  adminApp.route(
    "/social-credentials/twitter/oauth",
    createTwitterOAuthRouter(twitterOAuthDeps),
  );
  adminApp.route(
    "/social-credentials",
    createAdminSocialCredentialsRouter({
      getRepo: (scope) => createSocialCredentialsRepo(db, cipher, scope),
      getTokenRepo: (scope) => createSocialTokensRepo(db, cipher, scope),
      getAppRepo: () => createAppCredentialsRepo(db, cipher),
    }),
  );
  app.route("/api/admin", adminApp);

  app.route(
    "/api/super/app-credentials",
    createSuperAppCredentialsRouter({
      sessionSecret: SESSION_SECRET,
      getRepo: () => createAppCredentialsRepo(db, cipher),
    }),
  );

  return app;
}

beforeAll(async () => {
  const [tA] = await db
    .insert(tenants)
    .values({ slug: `${STAMP}-a`, name: `P12 A ${STAMP}`, status: "active" })
    .returning();
  const [tB] = await db
    .insert(tenants)
    .values({ slug: `${STAMP}-b`, name: `P12 B ${STAMP}`, status: "active" })
    .returning();
  tenantAId = tA.id;
  tenantBId = tB.id;
});

afterAll(async () => {
  await db.delete(socialTokens).where(inArray(socialTokens.tenantId, [tenantAId, tenantBId]));
  await db.delete(socialCredentials).where(inArray(socialCredentials.tenantId, [tenantAId, tenantBId]));
  await db.delete(appCredentials).where(inArray(appCredentials.key, ["linkedin_client", "twitter_collector", "twitter_client"]));
  await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
});

describe("P12 two-tier social credentials (e2e)", () => {
  it("test_REQ_083_creds_keyed_tenant_platform_encrypted — same platform for two tenants, ciphertext at rest", async () => {
    const app = buildApp(makeRedis());

    // Both tenants save their OWN Twitter posting credentials.
    for (const [cookie, key] of [
      [tenantCookie(USER_A, tenantAId), `ka-${STAMP}`],
      [tenantCookie(USER_B, tenantBId), `kb-${STAMP}`],
    ] as const) {
      const res = await app.request("/api/admin/social-credentials/twitter", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: key,
          apiSecret: `sec-${key}`,
          accessToken: `at-${key}`,
          accessTokenSecret: `ats-${key}`,
        }),
      });
      expect(res.status).toBe(200);
    }

    // Two rows, keyed (tenant_id, platform='twitter').
    const rows = await db
      .select()
      .from(socialCredentials)
      .where(inArray(socialCredentials.tenantId, [tenantAId, tenantBId]));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([tenantAId, tenantBId]));
    for (const row of rows) expect(row.platform).toBe("twitter");

    // Ciphertext at rest: raw jsonb never contains the plaintext key.
    for (const row of rows) {
      expect(JSON.stringify(row.encryptedFields)).not.toContain(`ka-${STAMP}`);
      expect(JSON.stringify(row.encryptedFields)).not.toContain(`kb-${STAMP}`);
    }

    // Tenant-scoped repo reads its own row only, and tenant A's ciphertext
    // decrypts back to tenant A's plaintext key.
    const repoA = createSocialCredentialsRepo(db, cipher, { tenantId: tenantAId, role: "tenant_admin" });
    const statusA = await repoA.getStatus();
    expect(statusA.twitter.configured).toBe(true);
    const rowA = rows.find((r) => r.tenantId === tenantAId);
    if (!rowA) throw new Error("expected tenant A row");
    const fieldsA = rowA.encryptedFields as { apiKey: Parameters<typeof cipher.decrypt>[0] };
    expect(cipher.decrypt(fieldsA.apiKey)).toBe(`ka-${STAMP}`);
  });

  it("test_REQ_082_app_secrets_not_in_tenant_response — tenant setters removed, secrets never serialized", async () => {
    const app = buildApp(makeRedis());

    // Super admin provisions the app-level secrets.
    const putClient = await app.request("/api/super/app-credentials/linkedin-client", {
      method: "PUT",
      headers: { cookie: superCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        clientId: `client-${STAMP}`,
        clientSecret: CLIENT_SECRET_SENTINEL,
        apiVersion: "202511",
      }),
    });
    expect(putClient.status).toBe(200);
    const putCookie = await app.request("/api/super/app-credentials/twitter-collector", {
      method: "PUT",
      headers: { cookie: superCookie(), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: COOKIE_SENTINEL }),
    });
    expect(putCookie.status).toBe(200);

    // Tenant admins can NO LONGER set app-level secrets (REQ-082).
    const tenantPutLinkedIn = await app.request("/api/admin/social-credentials/linkedin", {
      method: "PUT",
      headers: { cookie: tenantCookie(USER_A, tenantAId), "content-type": "application/json" },
      body: JSON.stringify({ clientId: "x", clientSecret: "y" }),
    });
    expect(tenantPutLinkedIn.status).toBe(404);
    const tenantPutCollector = await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "PUT",
      headers: { cookie: tenantCookie(USER_A, tenantAId), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "z" }),
    });
    expect(tenantPutCollector.status).toBe(404);

    // The super endpoints are super-admin-only.
    expect(
      (await app.request("/api/super/app-credentials")).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/super/app-credentials", {
          headers: { cookie: tenantCookie(USER_A, tenantAId) },
        })
      ).status,
    ).toBe(403);

    // Tenant-facing serializations never carry the secret values (NF6) —
    // booleans/timestamps only.
    const status = await app.request("/api/admin/social-credentials", {
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    expect(status.status).toBe(200);
    const statusText = await status.text();
    expect(statusText).not.toContain(CLIENT_SECRET_SENTINEL);
    expect(statusText).not.toContain(COOKIE_SENTINEL);
    const statusBody = JSON.parse(statusText) as {
      linkedin: { configured: boolean };
      twitterCollector: { configured: boolean };
    };
    expect(statusBody.linkedin.configured).toBe(true);
    expect(statusBody.twitterCollector.configured).toBe(true);

    // Super status responses are projections too — never the secret material.
    const superStatus = await app.request("/api/super/app-credentials", {
      headers: { cookie: superCookie() },
    });
    const superText = await superStatus.text();
    expect(superText).not.toContain(CLIENT_SECRET_SENTINEL);
    expect(superText).not.toContain(COOKIE_SENTINEL);
  });

  it("test_REQ_086_shared_collector_cookies_hidden — collector cookie resolvable from the app store, absent from tenant responses", async () => {
    // (Provisioned in the previous test.) The store decrypts for collection…
    const appRepo = createAppCredentialsRepo(db, cipher);
    const collector = await appRepo.getTwitterCollector();
    expect(collector?.apiKey).toBe(COOKIE_SENTINEL);

    // …while the raw row is ciphertext (never plaintext at rest)…
    const [raw] = await db
      .select()
      .from(appCredentials)
      .where(eq(appCredentials.key, "twitter_collector"));
    expect(JSON.stringify(raw.encryptedFields)).not.toContain(COOKIE_SENTINEL);

    // …and the tenant-facing surface exposes only a configured flag.
    const app = buildApp(makeRedis());
    const status = await app.request("/api/admin/social-credentials", {
      headers: { cookie: tenantCookie(USER_B, tenantBId) },
    });
    const text = await status.text();
    expect(text).not.toContain(COOKIE_SENTINEL);
  });

  it("test_REQ_080_linkedin_oauth_stores_tenant_tokens — per-tenant token isolation through the shared app client", async () => {
    const redis = makeRedis();
    const app = buildApp(redis, makeLinkedInFetch("personA"));

    // Tenant A starts the flow (shared client resolved from app_credentials).
    const start = await app.request("/api/admin/social-credentials/linkedin/oauth/start", {
      method: "POST",
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    expect(start.status).toBe(200);
    const { authorizeUrl } = (await start.json()) as { authorizeUrl: string };
    const state = new URL(authorizeUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    // LinkedIn redirects the browser back — token exchange + userinfo mocked.
    const cb = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=code-a&state=${state}`,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("linkedin=connected");

    // The token landed under tenant A — keyed (tenant_id, 'linkedin').
    const rows = await db
      .select()
      .from(socialTokens)
      .where(inArray(socialTokens.tenantId, [tenantAId, tenantBId]));
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantAId);
    expect(rows[0].platform).toBe("linkedin");
    // Ciphertext at rest (REQ-083).
    expect(JSON.stringify(rows[0].encryptedFields)).not.toContain("at-personA");

    // Tenant B sees no connection; tenant A decrypts its own token.
    const repoB = createSocialTokensRepo(db, cipher, { tenantId: tenantBId, role: "tenant_admin" });
    expect(await repoB.getLinkedIn()).toBeNull();
    const repoA = createSocialTokensRepo(db, cipher, { tenantId: tenantAId, role: "tenant_admin" });
    const tokenA = await repoA.getLinkedIn();
    expect(tokenA?.accessToken).toBe("at-personA");

    // GET /status for tenant A reports connected; for tenant B not connected.
    const statusA = await app.request("/api/admin/social-credentials/linkedin/oauth/status", {
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    const bodyA = (await statusA.json()) as { connected: boolean; clientConfigured: boolean };
    expect(bodyA.clientConfigured).toBe(true);
    expect(bodyA.connected).toBe(true);
    const statusB = await app.request("/api/admin/social-credentials/linkedin/oauth/status", {
      headers: { cookie: tenantCookie(USER_B, tenantBId) },
    });
    const bodyB = (await statusB.json()) as { connected: boolean };
    expect(bodyB.connected).toBe(false);
  });

  it("test_REQ_081_twitter_oauth_stores_tenant_tokens — OAuth2 connect through the shared app client; tokens keyed (tenant_id,'twitter'); no manual key entry", async () => {
    const redis = makeRedis();
    const app = buildApp(redis, undefined, makeTwitterProvider("agentloop"));

    // Super admin configures the SHARED Twitter OAuth2 app client (P13) —
    // tenants never enter client credentials themselves.
    const putClient = await app.request("/api/super/app-credentials/twitter-client", {
      method: "PUT",
      headers: { cookie: superCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        clientId: `tw-client-${STAMP}`,
        clientSecret: `tw-secret-${STAMP}`,
      }),
    });
    expect(putClient.status).toBe(200);

    // Tenant A starts the 3-legged flow: authorize URL + Redis-stored
    // { codeVerifier, tenantId } under the provider state.
    const start = await app.request("/api/admin/social-credentials/twitter/oauth/start", {
      method: "POST",
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    expect(start.status).toBe(200);
    const { authorizeUrl } = (await start.json()) as { authorizeUrl: string };
    const state = new URL(authorizeUrl).searchParams.get("state");
    expect(state).toBe("tw-state-agentloop");
    const storedState = redis.store.get(`twitter:oauth:state:${state}`);
    expect(storedState).toBeTruthy();
    expect(JSON.parse(storedState ?? "{}")).toMatchObject({
      codeVerifier: "cv-agentloop",
      tenantId: tenantAId,
    });

    // Twitter redirects the browser back — token exchange mocked (no session).
    const cb = await app.request(
      `/api/admin/social-credentials/twitter/oauth/callback?code=code-a&state=${state}`,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("twitter=connected");

    // The token landed under tenant A — keyed (tenant_id, 'twitter'),
    // ciphertext at rest.
    const rows = await db
      .select()
      .from(socialTokens)
      .where(inArray(socialTokens.tenantId, [tenantAId, tenantBId]));
    const twitterRows = rows.filter((r) => r.platform === "twitter");
    expect(twitterRows).toHaveLength(1);
    expect(twitterRows[0].tenantId).toBe(tenantAId);
    expect(JSON.stringify(twitterRows[0].encryptedFields)).not.toContain("tw-at-agentloop");

    // Tenant B sees no connection; tenant A decrypts its own token.
    const repoB = createSocialTokensRepo(db, cipher, { tenantId: tenantBId, role: "tenant_admin" });
    expect(await repoB.getTwitter()).toBeNull();
    const repoA = createSocialTokensRepo(db, cipher, { tenantId: tenantAId, role: "tenant_admin" });
    const tokenA = await repoA.getTwitter();
    expect(tokenA?.accessToken).toBe("tw-at-agentloop");
    expect(tokenA?.refreshToken).toBe("tw-rt-agentloop");

    // GET /status reflects connected + token expiry for A; not connected for B.
    const statusA = await app.request("/api/admin/social-credentials/twitter/oauth/status", {
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    const bodyA = (await statusA.json()) as {
      clientConfigured: boolean;
      connected: boolean;
      connectedAs: string | null;
      expiresAt: string | null;
      hasRefreshToken: boolean;
    };
    expect(bodyA.clientConfigured).toBe(true);
    expect(bodyA.connected).toBe(true);
    expect(bodyA.connectedAs).toBe("agentloop");
    expect(bodyA.expiresAt).toBe("2026-12-31T00:00:00.000Z");
    expect(bodyA.hasRefreshToken).toBe(true);
    const statusB = await app.request("/api/admin/social-credentials/twitter/oauth/status", {
      headers: { cookie: tenantCookie(USER_B, tenantBId) },
    });
    expect(((await statusB.json()) as { connected: boolean }).connected).toBe(false);

    // The state was consumed — a replayed callback fails.
    const replay = await app.request(
      `/api/admin/social-credentials/twitter/oauth/callback?code=code-a&state=${state}`,
    );
    expect(replay.headers.get("location")).toContain("twitter=error");

    // Cleanup: drop tenant A's twitter token so later tests start clean.
    expect(await repoA.deleteToken("twitter")).toBe(true);
  });

  it("DELETE /linkedin disconnects ONLY the calling tenant's token (tenant routes expose connect/disconnect)", async () => {
    const app = buildApp(makeRedis());
    // Tenant B disconnect is a no-op (no token) — removed:false.
    const delB = await app.request("/api/admin/social-credentials/linkedin", {
      method: "DELETE",
      headers: { cookie: tenantCookie(USER_B, tenantBId) },
    });
    expect(delB.status).toBe(200);
    expect(((await delB.json()) as { removed: boolean }).removed).toBe(false);

    // Tenant A disconnect removes its token row.
    const delA = await app.request("/api/admin/social-credentials/linkedin", {
      method: "DELETE",
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    expect(delA.status).toBe(200);
    expect(((await delA.json()) as { removed: boolean }).removed).toBe(true);

    const rows = await db
      .select()
      .from(socialTokens)
      .where(inArray(socialTokens.tenantId, [tenantAId, tenantBId]));
    expect(rows).toHaveLength(0);

    // twitter-collector is not a tenant platform anymore.
    const delCollector = await app.request("/api/admin/social-credentials/twitter-collector", {
      method: "DELETE",
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    expect(delCollector.status).toBe(400);
  });

  it("DELETE /api/super/app-credentials/:key clears app secrets (super-admin only)", async () => {
    const app = buildApp(makeRedis());
    const del1 = await app.request("/api/super/app-credentials/linkedin-client", {
      method: "DELETE",
      headers: { cookie: superCookie() },
    });
    expect(del1.status).toBe(200);
    expect(((await del1.json()) as { removed: boolean }).removed).toBe(true);
    const del2 = await app.request("/api/super/app-credentials/linkedin-client", {
      method: "DELETE",
      headers: { cookie: superCookie() },
    });
    expect(((await del2.json()) as { removed: boolean }).removed).toBe(false);

    const badKey = await app.request("/api/super/app-credentials/linkedin", {
      method: "DELETE",
      headers: { cookie: superCookie() },
    });
    expect(badKey.status).toBe(400);

    // Tenant admins cannot reach the delete either.
    const tenantDel = await app.request("/api/super/app-credentials/twitter-collector", {
      method: "DELETE",
      headers: { cookie: tenantCookie(USER_A, tenantAId) },
    });
    expect(tenantDel.status).toBe(403);
  });
});

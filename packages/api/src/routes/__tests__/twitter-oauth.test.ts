import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { requireUser } from "../../auth/middleware.js";
import { issueSession, COOKIE_NAME } from "../../auth/session.js";
import type {
  SocialTokensRepo,
  SaveSocialTokenInput,
  SocialTokenRecord,
} from "../../repositories/social-tokens.js";
import type {
  TwitterOAuthService,
  TwitterTokenSet,
} from "../../services/twitter-oauth.js";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
  type TwitterOAuthRouterDeps,
} from "../twitter-oauth.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const PUBLIC_BASE_URL = "https://agentloop.vertexcover.io";
const REDIRECT_URI = `${PUBLIC_BASE_URL}/api/admin/social-credentials/twitter/oauth/callback`;
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

const OAUTH_ENV = {
  PUBLIC_BASE_URL,
  TWITTER_OAUTH_CLIENT_ID: "app-client-id",
  TWITTER_OAUTH_CLIENT_SECRET: "app-client-secret",
};

function authCookie(tenantId = TENANT_A): string {
  const token = issueSession(
    { uid: "test-user", tid: tenantId, role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

interface InMemoryRedis {
  store: Map<string, string>;
  redis: TwitterOAuthRouterDeps["redis"];
}

function makeRedis(): InMemoryRedis {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      set(key, value): Promise<"OK"> {
        store.set(key, value);
        return Promise.resolve("OK" as const);
      },
      get(key): Promise<string | null> {
        return Promise.resolve(store.get(key) ?? null);
      },
      del(key): Promise<number> {
        return Promise.resolve(store.delete(key) ? 1 : 0);
      },
    },
  };
}

interface SavedToken {
  tenantId: string;
  platform: string;
  input: SaveSocialTokenInput;
}

function makeTokenRepos(existingTwitterRow?: SocialTokenRecord): {
  getTokenRepo: (tenantId: string) => SocialTokensRepo;
  saved: SavedToken[];
  deleted: { tenantId: string; platform: string }[];
} {
  const saved: SavedToken[] = [];
  const deleted: { tenantId: string; platform: string }[] = [];
  const getTokenRepo = (tenantId: string): SocialTokensRepo => ({
    saveToken(platform, input): Promise<void> {
      saved.push({ tenantId, platform, input });
      return Promise.resolve();
    },
    getToken(platform): Promise<SocialTokenRecord | null> {
      return Promise.resolve(
        platform === "twitter" ? (existingTwitterRow ?? null) : null,
      );
    },
    getLinkedIn(): Promise<SocialTokenRecord | null> {
      return Promise.resolve(null);
    },
    deleteToken(platform): Promise<boolean> {
      deleted.push({ tenantId, platform });
      return Promise.resolve(existingTwitterRow !== undefined);
    },
  });
  return { getTokenRepo, saved, deleted };
}

function makeOAuthService(overrides: Partial<TwitterOAuthService> = {}): {
  generateAuthLink: ReturnType<typeof vi.fn>;
  exchangeCode: ReturnType<typeof vi.fn>;
  factoryCreds: { clientId: string; clientSecret: string }[];
  factory: TwitterOAuthRouterDeps["oauthServiceFactory"];
} {
  const tokens: TwitterTokenSet = {
    accessToken: "at-value",
    refreshToken: "rt-value",
    expiresAt: new Date("2026-06-11T14:00:00.000Z"),
    connectedAs: "@agentloop",
  };
  const generateAuthLink = vi.fn().mockReturnValue({
    url: "https://twitter.com/i/oauth2/authorize?state=st-1",
    state: "st-1",
    codeVerifier: "cv-1",
  });
  const exchangeCode = vi.fn().mockResolvedValue({ ok: true, tokens });
  const service: TwitterOAuthService = {
    generateAuthLink,
    exchangeCode,
    refreshToken: vi.fn(),
    ...overrides,
  };
  const factoryCreds: { clientId: string; clientSecret: string }[] = [];
  return {
    generateAuthLink,
    exchangeCode,
    factoryCreds,
    factory: (creds) => {
      factoryCreds.push(creds);
      return service;
    },
  };
}

function buildTestApp(deps: TwitterOAuthRouterDeps): Hono {
  const app = new Hono();
  // Callback mounted BEFORE the gated adminApp — mirrors app.ts.
  app.route(
    "/api/admin/social-credentials/twitter/oauth/callback",
    createTwitterOAuthCallbackRouter(deps),
  );
  const gatedApp = new Hono();
  gatedApp.use("*", requireUser(SESSION_SECRET));
  gatedApp.route("/", createTwitterOAuthRouter(deps));
  app.route("/api/admin/social-credentials/twitter/oauth", gatedApp);
  return app;
}

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
});

describe("POST /start", () => {
  it("REQ-081: returns authorizeUrl; consume-once state blob holds tenantId + codeVerifier", async () => {
    const { store, redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory, factoryCreds, generateAuthLink } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie(TENANT_A) } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authorizeUrl: "https://twitter.com/i/oauth2/authorize?state=st-1",
    });
    expect(factoryCreds).toEqual([
      { clientId: "app-client-id", clientSecret: "app-client-secret" },
    ]);
    expect(generateAuthLink).toHaveBeenCalledWith(REDIRECT_URI);
    expect(JSON.parse(store.get("twitter:oauth:state:st-1") ?? "{}")).toEqual({
      tenantId: TENANT_A,
      codeVerifier: "cv-1",
    });
  });

  it("no TWITTER_OAUTH_CLIENT_ID/SECRET → 409 client_not_configured; no state stored", async () => {
    const { store, redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "client_not_configured" });
    expect(store.size).toBe(0);
  });

  it("start is session-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /callback", () => {
  async function start(app: Hono, tenantId = TENANT_A): Promise<void> {
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie(tenantId) } },
    );
    expect(res.status).toBe(200);
  }

  it("REQ-081: valid state → exchange (with PKCE verifier) → token saved under the STATE tenant → 302 ?twitter=connected", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory, exchangeCode } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });
    await start(app, TENANT_A);

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=code-abc&state=st-1",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("twitter=connected");
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "code-abc",
      codeVerifier: "cv-1",
      redirectUri: REDIRECT_URI,
    });
    expect(saved).toEqual([
      {
        tenantId: TENANT_A,
        platform: "twitter",
        input: {
          accessToken: "at-value",
          refreshToken: "rt-value",
          expiresAt: new Date("2026-06-11T14:00:00.000Z"),
          metadata: { name: "@agentloop" },
        },
      },
    ]);
  });

  it("callback binds to the STATE tenant, not the session: a tenant-B cookie cannot steal a tenant-A state", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });
    await start(app, TENANT_A); // state st-1 belongs to tenant A

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=code-abc&state=st-1",
      { headers: { cookie: authCookie(TENANT_B) } }, // attacker/session of tenant B
    );

    expect(res.status).toBe(302);
    expect(saved).toHaveLength(1);
    expect(saved[0].tenantId).toBe(TENANT_A); // never tenant B
  });

  it("unknown state → 302 ?twitter=error&reason=state; no exchange, no write", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory, exchangeCode } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=c&state=forged",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("twitter=error");
    expect(location).toContain("reason=state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("state is consume-once: second use fails", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });
    await start(app);

    const res1 = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=c1&state=st-1",
    );
    expect(res1.headers.get("location")).toContain("twitter=connected");

    const res2 = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=c2&state=st-1",
    );
    expect(res2.headers.get("location")).toContain("twitter=error");
    expect(saved).toHaveLength(1);
  });

  it("twitter ?error= (user denied) → reason=twitter_denied; no write", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?error=access_denied&state=anything",
    );

    expect(res.headers.get("location")).toContain("reason=twitter_denied");
    expect(saved).toHaveLength(0);
  });

  it("missing code with valid state → reason=state; no write", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });
    await start(app);

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?state=st-1",
    );

    expect(res.headers.get("location")).toContain("reason=state");
    expect(saved).toHaveLength(0);
  });

  it("exchange failure → reason=exchange; no write", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, saved } = makeTokenRepos();
    const { factory } = makeOAuthService({
      exchangeCode: vi
        .fn()
        .mockResolvedValue({ ok: false, detail: "invalid_request" }),
    });
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });
    await start(app);

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=bad&state=st-1",
    );

    expect(res.headers.get("location")).toContain("reason=exchange");
    expect(saved).toHaveLength(0);
  });

  it("callback is reachable WITHOUT a session cookie (state-gated, never 401)", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=x&state=nope",
    );
    expect(res.status).toBe(302);
  });

  it("NF6: error redirects never leak token material or the code verifier", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory } = makeOAuthService({
      exchangeCode: vi
        .fn()
        .mockResolvedValue({ ok: false, detail: "secret-detail at-value" }),
    });
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });
    await start(app);

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=bad&state=st-1",
    );

    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("cv-1");
    expect(location).not.toContain("at-value");
    expect(location).not.toContain("secret-detail");
  });
});

describe("GET /status", () => {
  const expiresAt = new Date("2026-12-31T00:00:00.000Z");

  it("connected row → shape without any token material (NF6/REQ-125)", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos({
      accessToken: "super-secret-access-token",
      refreshToken: "super-secret-refresh-token",
      expiresAt,
      metadata: { name: "@agentloop" },
    });
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("super-secret-access-token");
    expect(raw).not.toContain("super-secret-refresh-token");
    expect(JSON.parse(raw)).toEqual({
      clientConfigured: true,
      connected: true,
      connectedAs: "@agentloop",
      expiresAt: expiresAt.toISOString(),
      hasRefreshToken: true,
    });
  });

  it("no token row → connected:false; clientConfigured reflects env", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(await res.json()).toEqual({
      clientConfigured: false,
      connected: false,
      connectedAs: null,
      expiresAt: null,
      hasRefreshToken: false,
    });
  });

  it("empty refreshToken sentinel → hasRefreshToken:false", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos({
      accessToken: "at",
      refreshToken: "",
      expiresAt,
      metadata: null,
    });
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    const body = (await res.json()) as { connected: boolean; hasRefreshToken: boolean };
    expect(body.connected).toBe(true);
    expect(body.hasRefreshToken).toBe(false);
  });

  it("status is session-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo } = makeTokenRepos();
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE / (disconnect)", () => {
  it("removes the requesting tenant's twitter token", async () => {
    const { redis } = makeRedis();
    const { getTokenRepo, deleted } = makeTokenRepos({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(),
      metadata: null,
    });
    const { factory } = makeOAuthService();
    const app = buildTestApp({
      getTokenRepo,
      redis,
      env: OAUTH_ENV,
      oauthServiceFactory: factory,
    });

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth",
      { method: "DELETE", headers: { cookie: authCookie(TENANT_A) } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: true });
    expect(deleted).toEqual([{ tenantId: TENANT_A, platform: "twitter" }]);
  });
});

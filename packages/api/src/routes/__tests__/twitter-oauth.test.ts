import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { requireAuth } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import type {
  SocialTokensRepo,
  SaveSocialTokenInput,
  SocialTokenRecord,
} from "../../repositories/social-tokens.js";
import type {
  AppCredentialsRepo,
  TwitterClientRecord,
} from "../../repositories/app-credentials.js";
import type {
  TwitterOAuthProvider,
  TwitterExchangeResult,
} from "../../services/twitter-oauth.js";
import type { TwitterOAuthRouterDeps } from "../../routes/twitter-oauth.js";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
} from "../../routes/twitter-oauth.js";

// ── constants ─────────────────────────────────────────────────────────────────
const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const PUBLIC_BASE_URL = "https://agentloop.vertexcover.io";
const REDIRECT_URI = `${PUBLIC_BASE_URL}/api/admin/social-credentials/twitter/oauth/callback`;
const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";

// ── helpers ───────────────────────────────────────────────────────────────────
function authCookie(tenantId: string | null = TENANT_ID): string {
  const token = issueToken(
    { userId: "00000000-0000-4000-8000-000000000001", tenantId, role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

interface InMemoryRedis {
  store: Map<string, string>;
  redis: {
    set(key: string, value: string, exMode: string, seconds: number): Promise<"OK">;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<number>;
  };
}

function makeRedis(): InMemoryRedis {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      set(key: string, value: string): Promise<"OK"> {
        store.set(key, value);
        return Promise.resolve("OK" as const);
      },
      get(key: string): Promise<string | null> {
        return Promise.resolve(store.get(key) ?? null);
      },
      del(key: string): Promise<number> {
        return Promise.resolve(store.delete(key) ? 1 : 0);
      },
    },
  };
}

function makeCredRepo(
  record: TwitterClientRecord | null,
): Pick<AppCredentialsRepo, "getTwitterClient" | "getStatus"> {
  return {
    getStatus: vi.fn().mockResolvedValue({
      linkedinClient: { configured: false, apiVersion: null, updatedAt: null },
      twitterCollector: { configured: false, updatedAt: null },
      twitterClient: { configured: record !== null, updatedAt: null },
    }),
    getTwitterClient: vi.fn().mockResolvedValue(record),
  };
}

interface SavedToken {
  platform: string;
  input: SaveSocialTokenInput;
}

function makeTokenRepo(existingRow?: SocialTokenRecord): {
  repo: Pick<SocialTokensRepo, "saveToken" | "getTwitter">;
  saved: SavedToken[];
} {
  const saved: SavedToken[] = [];
  const repo: Pick<SocialTokensRepo, "saveToken" | "getTwitter"> = {
    saveToken(platform: string, input: SaveSocialTokenInput): Promise<void> {
      saved.push({ platform, input });
      return Promise.resolve();
    },
    getTwitter(): Promise<SocialTokenRecord | null> {
      return Promise.resolve(existingRow ?? null);
    },
  };
  return { repo, saved };
}

interface FakeProvider {
  provider: TwitterOAuthProvider;
  generateCalls: { clientId: string; clientSecret: string; redirectUri: string }[];
  exchangeCalls: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }[];
}

function makeProvider(
  exchangeResult: TwitterExchangeResult = {
    ok: true,
    accessToken: "tw-at",
    refreshToken: "tw-rt",
    expiresAt: new Date("2026-06-11T12:00:00.000Z"),
    username: "agentloop",
  },
): FakeProvider {
  const generateCalls: FakeProvider["generateCalls"] = [];
  const exchangeCalls: FakeProvider["exchangeCalls"] = [];
  return {
    generateCalls,
    exchangeCalls,
    provider: {
      generateAuthLink(input) {
        generateCalls.push(input);
        return {
          url: "https://x.com/i/oauth2/authorize?response_type=code&state=st-123",
          codeVerifier: "cv-123",
          state: "st-123",
        };
      },
      exchangeCode(input) {
        exchangeCalls.push(input);
        return Promise.resolve(exchangeResult);
      },
    },
  };
}

function buildTestApp(deps: TwitterOAuthRouterDeps): Hono {
  const app = new Hono();

  // Callback mounted OUTSIDE the gate — mirrors app.ts (D-001).
  app.route(
    "/api/admin/social-credentials/twitter/oauth/callback",
    createTwitterOAuthCallbackRouter(deps),
  );

  const gate = requireAuth(SESSION_SECRET);
  const gatedApp = new Hono();
  gatedApp.use("*", gate);
  gatedApp.route("/", createTwitterOAuthRouter(deps));
  app.route("/api/admin/social-credentials/twitter/oauth", gatedApp);

  return app;
}

const twitterClientRecord: TwitterClientRecord = {
  clientId: "tw-client-id",
  clientSecret: "tw-client-secret",
  updatedAt: new Date(),
};

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-081: POST /start → authorize URL; codeVerifier + tenant id stored in Redis.
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /start", () => {
  it("test_REQ_081_start_returns_authorize_url_and_stores_state — codeVerifier + starting tenant stored under the state key", async () => {
    const { store, redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizeUrl: string };
    expect(body.authorizeUrl).toContain("https://x.com/i/oauth2/authorize");

    // The auth link was generated against the SHARED app client + our callback.
    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0]).toEqual({
      clientId: "tw-client-id",
      clientSecret: "tw-client-secret",
      redirectUri: REDIRECT_URI,
    });

    // codeVerifier + starting tenant id stored under the state key (consume-once).
    const stored = store.get("twitter:oauth:state:st-123");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored ?? "{}") as { codeVerifier: string; tenantId: string };
    expect(parsed.codeVerifier).toBe("cv-123");
    expect(parsed.tenantId).toBe(TENANT_ID);
  });

  it("no client configured (DB + env empty) → 409 client_not_configured; nothing stored", async () => {
    const { store, redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(null),
      getTokenRepo: () => tokenRepo,
      redis,
      env: {},
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("client_not_configured");
    expect(store.size).toBe(0);
  });

  it("falls back to TWITTER_OAUTH2_CLIENT_ID/SECRET env when the DB store is empty", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(null),
      getTokenRepo: () => tokenRepo,
      redis,
      env: {
        PUBLIC_BASE_URL,
        TWITTER_OAUTH2_CLIENT_ID: "env-tw-id",
        TWITTER_OAUTH2_CLIENT_SECRET: "env-tw-secret",
      },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    expect(fake.generateCalls[0].clientId).toBe("env-tw-id");
  });

  it("start route is admin-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-081: GET /callback → loginWithOAuth2 exchange → token stored under the
// STARTING tenant (the session-less callback derives the tenant from the state).
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /callback", () => {
  async function start(app: Hono): Promise<void> {
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );
    expect(res.status).toBe(200);
  }

  it("test_REQ_081_callback_stores_tenant_tokens — exchange uses the stored codeVerifier; token saved under (startingTenant,'twitter')", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const tokenRepoScopes: (TenantScope | undefined)[] = [];
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: (scope?: TenantScope) => {
        tokenRepoScopes.push(scope);
        return tokenRepo;
      },
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    await start(app);

    // Twitter redirects the browser back — NO session cookie on this request.
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=auth-code-abc&state=st-123",
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("twitter=connected");

    // Exchange used the code + the Redis-stored codeVerifier + our redirect URI.
    expect(fake.exchangeCalls).toHaveLength(1);
    expect(fake.exchangeCalls[0]).toEqual({
      clientId: "tw-client-id",
      clientSecret: "tw-client-secret",
      code: "auth-code-abc",
      codeVerifier: "cv-123",
      redirectUri: REDIRECT_URI,
    });

    // Token saved under platform 'twitter' for the STARTING tenant.
    expect(saved).toHaveLength(1);
    expect(saved[0].platform).toBe("twitter");
    expect(saved[0].input.accessToken).toBe("tw-at");
    expect(saved[0].input.refreshToken).toBe("tw-rt");
    expect(saved[0].input.expiresAt.toISOString()).toBe("2026-06-11T12:00:00.000Z");
    expect(saved[0].input.metadata?.name).toBe("agentloop");
    const callbackScope = tokenRepoScopes.at(-1);
    expect(callbackScope).toMatchObject({ tenantId: TENANT_ID });
  });

  it("missing/unknown state → 302 ?twitter=error&reason=state; no write", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=x&state=unknown-state",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("twitter=error");
    expect(location).toContain("reason=state");
    expect(saved).toHaveLength(0);
  });

  it("state is consume-once — second use of the same state fails", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    await start(app);

    const res1 = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=c1&state=st-123",
    );
    expect(res1.headers.get("location")).toContain("twitter=connected");

    const res2 = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=c2&state=st-123",
    );
    expect(res2.headers.get("location")).toContain("twitter=error");
  });

  it("Twitter ?error= (user denied) → 302 reason=twitter_denied; no write", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?error=access_denied&state=anything",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("twitter=error");
    expect(location).toContain("reason=twitter_denied");
    expect(saved).toHaveLength(0);
  });

  it("exchange failure → 302 reason=exchange; no write", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider({ ok: false });
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    await start(app);

    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=bad&state=st-123",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("twitter=error");
    expect(location).toContain("reason=exchange");
    expect(saved).toHaveLength(0);
  });

  it("callback does NOT require an admin cookie (D-001: state-gated, not cookie-gated)", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=x&state=nonexistent",
    );
    expect(res.status).toBe(302);
    expect(res.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /status → connected + token expiry for the CALLING tenant.
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /status", () => {
  const expiresAt = new Date("2026-12-31T00:00:00.000Z");

  it("connected row → { clientConfigured, connected, connectedAs, expiresAt, hasRefreshToken }", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo({
      accessToken: "tw-at",
      refreshToken: "tw-rt",
      expiresAt,
      metadata: { name: "agentloop" },
    });
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clientConfigured: boolean;
      connected: boolean;
      connectedAs: string | null;
      expiresAt: string | null;
      hasRefreshToken: boolean;
    };
    expect(body.clientConfigured).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.connectedAs).toBe("agentloop");
    expect(body.expiresAt).toBe(expiresAt.toISOString());
    expect(body.hasRefreshToken).toBe(true);
  });

  it("no token row → connected: false, expiresAt null", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      connected: boolean;
      connectedAs: string | null;
      expiresAt: string | null;
      hasRefreshToken: boolean;
    };
    expect(body.connected).toBe(false);
    expect(body.connectedAs).toBeNull();
    expect(body.expiresAt).toBeNull();
    expect(body.hasRefreshToken).toBe(false);
  });

  it("status route is admin-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const fake = makeProvider();
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: TwitterOAuthRouterDeps = {
      getAppCredsRepo: () => makeCredRepo(twitterClientRecord),
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      provider: fake.provider,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
    );
    expect(res.status).toBe(401);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import type { SocialTokensRepo } from "../../repositories/social-tokens.js";
import type { SocialCredentialsRepo } from "../../repositories/social-credentials.js";
import type { TwitterOAuthRouterDeps } from "../../routes/twitter-oauth.js";
import {
  createTwitterOAuthRouter,
  createTwitterOAuthCallbackRouter,
} from "../../routes/twitter-oauth.js";

// Mock twitter-api-v2 for all route tests — real HTTP calls to X are not available.
vi.mock("twitter-api-v2", () => {
  const mockLoginWithOAuth2 = vi.fn().mockResolvedValue({
    client: { v2: { me: vi.fn().mockResolvedValue({ data: { username: "testuser" } }) } },
    accessToken: "tw-at",
    refreshToken: "tw-rt",
    expiresIn: 7200,
  });
  const MockTwitterApi = vi.fn().mockImplementation((opts?: { clientId?: string; clientSecret?: string }) => {
    // If constructed with clientId/clientSecret, return the auth client mock
    if (opts && ("clientId" in opts || "clientSecret" in opts)) {
      return {
        generateOAuth2AuthLink: vi.fn().mockReturnValue({
          url: "https://x.com/i/oauth2/authorize?response_type=code&client_id=tw-client-id&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&state=st-mock&code_challenge=cv&code_challenge_method=s256&scope=tweet.read%20tweet.write%20users.read%20offline.access",
          codeVerifier: "cv-mock",
          state: "st-mock",
        }),
        loginWithOAuth2: mockLoginWithOAuth2,
      };
    }
    // Post-login client (constructed with access token)
    return {
      v2: { me: vi.fn().mockResolvedValue({ data: { username: "testuser" } }) },
    };
  });
  return { TwitterApi: MockTwitterApi };
});

// ── constants ─────────────────────────────────────────────────────────────────
const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const PUBLIC_BASE_URL = "https://agentloop.vertexcover.io";
const TWITTER_CLIENT_ID = "tw-client-id";
const TWITTER_CLIENT_SECRET = "tw-client-secret";

// ── helpers ───────────────────────────────────────────────────────────────────
function authCookie(): string {
  const token = issueToken(SESSION_SECRET);
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
      set(key: string, value: string, _exMode: string, _seconds: number): Promise<"OK"> {
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
  hasTwitter: boolean,
): SocialCredentialsRepo {
  return {
    getStatus: vi.fn().mockResolvedValue({
      linkedin: { configured: false, apiVersion: null, updatedAt: null },
      twitter: { configured: hasTwitter, updatedAt: null },
      twitterCollector: { configured: false, updatedAt: null },
    }),
    getLinkedIn: vi.fn().mockResolvedValue(null),
    upsertLinkedIn: vi.fn().mockResolvedValue({ updatedAt: new Date().toISOString() }),
    upsertTwitter: vi.fn().mockResolvedValue({ updatedAt: new Date().toISOString() }),
    upsertTwitterCollector: vi.fn().mockResolvedValue({ updatedAt: new Date().toISOString() }),
    delete: vi.fn().mockResolvedValue(true),
  };
}

interface SavedToken {
  platform: string;
  accessToken: string;
  refreshToken: string | null;
}

function makeTokenRepo(existingRow?: {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  metadata?: { name?: string } | null;
}): { repo: SocialTokensRepo; saved: SavedToken[] } {
  const saved: SavedToken[] = [];
  const repo: SocialTokensRepo = {
    saveToken(_platform: string, input: Parameters<SocialTokensRepo["saveToken"]>[1]): Promise<void> {
      saved.push({
        platform: _platform,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
      });
      return Promise.resolve();
    },
    getToken(platform: string) {
      if (!existingRow || platform !== "twitter") return Promise.resolve(null);
      return Promise.resolve({
        accessToken: existingRow.accessToken,
        refreshToken: existingRow.refreshToken,
        expiresAt: existingRow.expiresAt,
        metadata: existingRow.metadata ?? null,
      });
    },
    getLinkedIn() {
      return Promise.resolve(null);
    },
    getTwitter() {
      if (!existingRow) return Promise.resolve(null);
      return Promise.resolve({
        accessToken: existingRow.accessToken,
        refreshToken: existingRow.refreshToken,
        expiresAt: existingRow.expiresAt,
        metadata: existingRow.metadata ?? null,
      });
    },
    deleteToken(): Promise<boolean> {
      return Promise.resolve(existingRow !== undefined);
    },
  };
  return { repo, saved };
}

/** Twitter OAuth2 app credentials resolver — mocks reading app_credentials */
function makeAppCredResolver() {
  return vi.fn().mockResolvedValue({
    clientId: TWITTER_CLIENT_ID,
    clientSecret: TWITTER_CLIENT_SECRET,
  });
}

function buildTestApp(deps: TwitterOAuthRouterDeps): Hono {
  const app = new Hono();

  // Callback mounted before admin gate
  const callbackRouter = createTwitterOAuthCallbackRouter(deps);
  app.route(
    "/api/admin/social-credentials/twitter/oauth/callback",
    callbackRouter,
  );

  // Admin-gated routes
  const gate = requireAdmin(SESSION_SECRET);
  const startRouter = createTwitterOAuthRouter(deps);
  const gatedApp = new Hono();
  gatedApp.use("*", gate);
  gatedApp.route("/", startRouter);
  app.route("/api/admin/social-credentials/twitter/oauth", gatedApp);

  return app;
}

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-081: POST /start → 200 { authorizeUrl }; state + codeVerifier stored in Redis
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /start", () => {
  it("returns 200 with authorizeUrl; state + codeVerifier stored in Redis", async () => {
    const { store, redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizeUrl: string };
    expect(body.authorizeUrl).toContain("oauth2/authorize");

    // State and codeVerifier must be stored in Redis.
    // We just check Redis has entries — the key prefix is "twitter:oauth:state:" and "twitter:oauth:codeverifier:"
    const stateKeys = [...store.keys()].filter((k) => k.startsWith("twitter:oauth:state:"));
    expect(stateKeys.length).toBe(1);
    const cvKeys = [...store.keys()].filter((k) => k.startsWith("twitter:oauth:codeverifier:"));
    expect(cvKeys.length).toBe(1);
  });

  it("no client credentials → 409; no state stored", async () => {
    const { store, redis } = makeRedis();
    const credRepo = makeCredRepo(false);
    const { repo: tokenRepo } = makeTokenRepo();
    const resolveTwitterOAuth2App = vi.fn().mockResolvedValue(null);

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("client_not_configured");
    expect(store.size).toBe(0);
  });

  it("start route is admin-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
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
// GET /callback
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /callback", () => {
  it("valid state → exchange code → save encrypted token → 302 ?twitter=connected", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);

    // First do /start to populate Redis state
    const startRes = await app.request(
      "/api/admin/social-credentials/twitter/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );
    const startBody = (await startRes.json()) as { authorizeUrl: string };
    const url = new URL(startBody.authorizeUrl);
    const state = url.searchParams.get("state") ?? "";

    // Now call callback with code + state
    const res = await app.request(
      `/api/admin/social-credentials/twitter/oauth/callback?code=auth-code-abc&state=${state}`,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("twitter=connected");

    // Token was saved.
    expect(saved.length).toBe(1);
    expect(saved[0].accessToken).toBe("tw-at");
    expect(saved[0].refreshToken).toBe("tw-rt");
  });

  it("missing state → 302 ?twitter=error&reason=state; no write", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=code&state=bad-state",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("twitter=error");
    expect(location).toContain("reason=state");
    expect(saved.length).toBe(0);
  });

  it("callback does NOT require admin cookie (ungated)", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    // Hit callback WITHOUT admin cookie
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/callback?code=x&state=nonexistent",
    );

    // Must be 302, never 401.
    expect(res.status).toBe(302);
    expect(res.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /status
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /status", () => {
  const expiresAt = new Date("2026-12-31T00:00:00.000Z");

  it("connected row → full shape", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo({
      accessToken: "at-val",
      refreshToken: "rt-val",
      expiresAt,
      metadata: { name: "testtwitteruser" },
    });
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
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
    expect(body.connectedAs).toBe("testtwitteruser");
    expect(body.expiresAt).toBe(expiresAt.toISOString());
    expect(body.hasRefreshToken).toBe(true);
  });

  it("no social_tokens row → connected: false", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("empty refreshToken sentinel → hasRefreshToken: false", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo({
      accessToken: "at-without-rt",
      refreshToken: "", // sentinel
      expiresAt,
      metadata: null,
    });
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; hasRefreshToken: boolean };
    expect(body.connected).toBe(true);
    expect(body.hasRefreshToken).toBe(false);
  });

  it("status route is admin-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(true);
    const { repo: tokenRepo } = makeTokenRepo();
    const resolveTwitterOAuth2App = makeAppCredResolver();

    const deps: TwitterOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      resolveTwitterOAuth2App,
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/twitter/oauth/status",
    );
    expect(res.status).toBe(401);
  });
});

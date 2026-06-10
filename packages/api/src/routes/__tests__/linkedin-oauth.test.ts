import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { requireAuth } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import type { SocialTokensRepo, SaveSocialTokenInput } from "../../repositories/social-tokens.js";
import type {
  SocialCredentialsRepo,
  LinkedInCredentialRecord,
} from "../../repositories/social-credentials.js";
import type { LinkedInOAuthRouterDeps } from "../../routes/linkedin-oauth.js";
import {
  createLinkedInOAuthRouter,
  createLinkedInOAuthCallbackRouter,
} from "../../routes/linkedin-oauth.js";

// ── constants ─────────────────────────────────────────────────────────────────
const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const PUBLIC_BASE_URL = "https://agentloop.vertexcover.io";
const REDIRECT_URI = `${PUBLIC_BASE_URL}/api/admin/social-credentials/linkedin/oauth/callback`;

// ── helpers ───────────────────────────────────────────────────────────────────
function authCookie(): string {
  const token = issueToken({ userId: "00000000-0000-4000-8000-000000000001", tenantId: null, role: "tenant_admin" }, SESSION_SECRET);
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

/** Minimal in-memory Redis mock used by start + callback routes. */
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

/** In-memory social-credentials repo with optional LinkedIn record. */
function makeCredRepo(
  record: LinkedInCredentialRecord | null,
): SocialCredentialsRepo {
  return {
    getStatus: vi.fn().mockResolvedValue({
      linkedin: { configured: record !== null, apiVersion: null, updatedAt: null },
      twitter: { configured: false, updatedAt: null },
      twitterCollector: { configured: false, updatedAt: null },
    }),
    getLinkedIn: vi.fn().mockResolvedValue(record),
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
  personUrn: string | undefined;
}

/** In-memory social-tokens repo that records saveToken calls. */
function makeTokenRepo(existingRow?: {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  metadata?: { personUrn?: string; name?: string } | null;
}): { repo: SocialTokensRepo; saved: SavedToken[] } {
  const saved: SavedToken[] = [];
  const repo: SocialTokensRepo = {
    saveToken(_platform: string, input: SaveSocialTokenInput): Promise<void> {
      saved.push({
        platform: _platform,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        personUrn: input.metadata?.personUrn,
      });
      return Promise.resolve();
    },
    getLinkedIn(): Promise<{
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date;
      metadata: { personUrn?: string; name?: string } | null;
    } | null> {
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

/** Build the full protected test app with the admin-gated start route + ungated callback. */
function buildTestApp(deps: LinkedInOAuthRouterDeps): Hono {
  const app = new Hono();

  // IMPORTANT: The callback route must be mounted BEFORE the gated adminApp
  // so that requests to /api/admin/social-credentials/linkedin/oauth/callback
  // are matched here — not by the gate on the broader adminApp path.
  // This mirrors how app.ts mounts the callback outside adminApp.
  const callbackRouter = createLinkedInOAuthCallbackRouter(deps);
  app.route(
    "/api/admin/social-credentials/linkedin/oauth/callback",
    callbackRouter,
  );

  // Admin-gated start + status routes (mirror app.ts gate).
  const gate = requireAuth(SESSION_SECRET);
  const startRouter = createLinkedInOAuthRouter(deps);
  const gatedApp = new Hono();
  gatedApp.use("*", gate);
  gatedApp.route("/", startRouter);
  app.route("/api/admin/social-credentials/linkedin/oauth", gatedApp);

  return app;
}

// ── fixtures ──────────────────────────────────────────────────────────────────
const linkedInRecord: LinkedInCredentialRecord = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  apiVersion: "202511",
  updatedAt: new Date(),
};

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-001: POST /start → 200 { authorizeUrl }; state stored in Redis.
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /start", () => {
  it("REQ-001: returns 200 with authorizeUrl; state key stored in Redis", async () => {
    const { store, redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizeUrl: string };
    expect(body.authorizeUrl).toContain(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
    expect(body.authorizeUrl).toContain("response_type=code");
    expect(body.authorizeUrl).toContain("client_id=test-client-id");
    expect(body.authorizeUrl).toContain(encodeURIComponent(REDIRECT_URI));

    // State must be stored in Redis.
    const url = new URL(body.authorizeUrl);
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(store.has(`linkedin:oauth:state:${state}`)).toBe(true);
  });

  it("REQ-002: no client credentials → 409 { error: 'client_not_configured' }; no state stored", async () => {
    const { store, redis } = makeRedis();
    const credRepo = makeCredRepo(null); // DB empty
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: {}, // no env creds either
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("client_not_configured");
    expect(store.size).toBe(0);
  });

  it("EDGE-003: clientId/secret from env when DB getLinkedIn returns null", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(null); // DB empty
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: {
        PUBLIC_BASE_URL,
        LINKEDIN_CLIENT_ID: "env-client-id",
        LINKEDIN_CLIENT_SECRET: "env-client-secret",
      },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizeUrl: string };
    expect(body.authorizeUrl).toContain("client_id=env-client-id");
  });

  it("start route is admin-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/start",
      { method: "POST" }, // no cookie
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-003: GET /callback with valid state → exchange code → save encrypted token → 302 ?linkedin=connected
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /callback", () => {
  function makeFetchSuccess(): typeof fetch {
    let callCount = 0;
    return vi.fn((): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        // Token exchange call
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "at-value",
              refresh_token: "rt-value",
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      // Userinfo call
      return Promise.resolve(
        new Response(
          JSON.stringify({ sub: "person-id-123", name: "Test User" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as typeof fetch;
  }

  async function startAndGetState(app: Hono): Promise<string> {
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );
    const body = (await res.json()) as { authorizeUrl: string };
    return new URL(body.authorizeUrl).searchParams.get("state") ?? "";
  }

  it("REQ-003: valid state → exchange + userinfo + encrypted upsert → 302 ?linkedin=connected", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const fetchFn = makeFetchSuccess();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn,

    };

    const app = buildTestApp(deps);
    const state = await startAndGetState(app);
    expect(state).toBeTruthy();

    const res = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=auth-code-abc&state=${state}`,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("linkedin=connected");

    // Token was saved.
    expect(saved.length).toBe(1);
    expect(saved[0].accessToken).toBe("at-value");
    expect(saved[0].refreshToken).toBe("rt-value");
    expect(saved[0].personUrn).toBe("urn:li:person:person-id-123");
  });

  it("REQ-004/EDGE-002: missing state → 302 ?linkedin=error&reason=state; no write", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn: makeFetchSuccess(),

    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/callback?code=auth-code-abc&state=bad-state",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("linkedin=error");
    expect(location).toContain("reason=state");
    expect(saved.length).toBe(0);
  });

  it("LinkedIn ?error= → 302 ?linkedin=error&reason=linkedin_denied; no write", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn: makeFetchSuccess(),
    };

    const app = buildTestApp(deps);
    // LinkedIn rejection: it redirects back with ?error= and no code.
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/callback?error=user_cancelled_login&error_description=denied&state=anything",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("linkedin=error");
    expect(location).toContain("reason=linkedin_denied");
    expect(saved.length).toBe(0);
  });

  it("EDGE-002: consumed state (second use) → 302 error", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn: makeFetchSuccess(),

    };

    const app = buildTestApp(deps);
    const state = await startAndGetState(app);

    // First use succeeds.
    const res1 = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=code1&state=${state}`,
    );
    expect(res1.status).toBe(302);
    expect(res1.headers.get("location")).toContain("linkedin=connected");

    // State is consumed; second use should fail (same app, same redis).
    const res2 = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=code2&state=${state}`,
    );
    expect(res2.status).toBe(302);
    expect(res2.headers.get("location")).toContain("linkedin=error");
  });

  it("REQ-005: token exchange non-2xx → 302 ?linkedin=error&reason=exchange; no write", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    const fetchFn = vi.fn((): Promise<Response> => {
      // Exchange call fails.
      return Promise.resolve(new Response("Unauthorized", { status: 401 }));
    }) as typeof fetch;

    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn,

    };

    const app = buildTestApp(deps);
    const state = await startAndGetState(app);

    const res = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=bad-code&state=${state}`,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("linkedin=error");
    expect(location).toContain("reason=exchange");
    expect(saved.length).toBe(0);
  });

  it("REQ-005: userinfo failure → 302 ?linkedin=error&reason=userinfo; no write", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    let exchangeCallCount = 0;
    const fetchFn = vi.fn((): Promise<Response> => {
      exchangeCallCount++;
      if (exchangeCallCount === 1) {
        // Token exchange succeeds.
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "at", expires_in: 3600 }),
            { status: 200 },
          ),
        );
      }
      // Userinfo fails.
      return Promise.resolve(new Response("Forbidden", { status: 403 }));
    }) as typeof fetch;

    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn,

    };

    const app = buildTestApp(deps);
    const state = await startAndGetState(app);

    const res = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=code&state=${state}`,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("linkedin=error");
    expect(location).toContain("reason=userinfo");
    expect(saved.length).toBe(0);
  });

  it("REQ-014: missing refresh_token in exchange response → still upserts access token", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo, saved } = makeTokenRepo();
    let noRefreshCallCount = 0;
    const fetchFn = vi.fn((): Promise<Response> => {
      noRefreshCallCount++;
      if (noRefreshCallCount === 1) {
        // No refresh_token.
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "at-only", expires_in: 3600 }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ sub: "person-456", name: "User" }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn,

    };

    const app = buildTestApp(deps);
    const state = await startAndGetState(app);

    const res = await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=code&state=${state}`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("linkedin=connected");
    expect(saved.length).toBe(1);
    expect(saved[0].accessToken).toBe("at-only");
    expect(saved[0].refreshToken).toBeNull();
  });

  // EDGE-008: callback reachable without admin cookie.
  it("EDGE-008: callback does NOT require admin cookie (ungated)", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },

    };

    const app = buildTestApp(deps);

    // Hit callback WITHOUT admin cookie. State is invalid so we get a
    // 302 to error — but NOT a 401. This proves the handler is reachable.
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/callback?code=x&state=nonexistent",
      // Deliberately no cookie header.
    );

    // Must be 302 (any redirect), never 401.
    expect(res.status).toBe(302);
    expect(res.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-011, REQ-014: GET /status → full connection-status shape
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /status", () => {
  const expiresAt = new Date("2026-12-31T00:00:00.000Z");

  it("REQ-011: connected row → full shape { connected, connectedAs, expiresAt, hasRefreshToken }", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo({
      accessToken: "at-value",
      refreshToken: "rt-value",
      expiresAt,
      metadata: { personUrn: "urn:li:person:123", name: "Alice Smith" },
    });
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/status",
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
    expect(body.connectedAs).toBe("Alice Smith");
    expect(body.expiresAt).toBe(expiresAt.toISOString());
    expect(body.hasRefreshToken).toBe(true);
  });

  it("REQ-011: no social_tokens row → connected: false", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo(); // no row
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/status",
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

  it("REQ-014: empty refreshToken sentinel → hasRefreshToken: false", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo({
      accessToken: "at-value",
      refreshToken: "", // sentinel: encrypted empty string
      expiresAt,
      metadata: null,
    });
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/status",
      { headers: { cookie: authCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasRefreshToken: boolean; connected: boolean };
    expect(body.connected).toBe(true);
    expect(body.hasRefreshToken).toBe(false);
  });

  it("status route is admin-gated (no cookie → 401)", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const { repo: tokenRepo } = makeTokenRepo();
    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
    };

    const app = buildTestApp(deps);
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/status",
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQ-003/name: callback persists name from userinfo into metadata
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /callback — name persistence", () => {
  async function startAndGetStateLocal(app: Hono): Promise<string> {
    const res = await app.request(
      "/api/admin/social-credentials/linkedin/oauth/start",
      { method: "POST", headers: { cookie: authCookie() } },
    );
    const body = (await res.json()) as { authorizeUrl: string };
    return new URL(body.authorizeUrl).searchParams.get("state") ?? "";
  }

  it("REQ-003/name: callback persists name from userinfo into metadata", async () => {
    const { redis } = makeRedis();
    const credRepo = makeCredRepo(linkedInRecord);
    const savedTokens: { platform: string; input: SaveSocialTokenInput }[] = [];
    const tokenRepo: SocialTokensRepo = {
      saveToken(platform, input) {
        savedTokens.push({ platform, input });
        return Promise.resolve();
      },
      getLinkedIn() {
        return Promise.resolve(null);
      },
      deleteToken() {
        return Promise.resolve(false);
      },
    };
    let callCount = 0;
    const fetchFn = vi.fn((): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ sub: "person-xyz", name: "Jane Doe" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const deps: LinkedInOAuthRouterDeps = {
      getCredRepo: () => credRepo,
      getTokenRepo: () => tokenRepo,
      redis,
      env: { PUBLIC_BASE_URL },
      fetchFn,
    };

    const app = buildTestApp(deps);
    const state = await startAndGetStateLocal(app);
    await app.request(
      `/api/admin/social-credentials/linkedin/oauth/callback?code=code-abc&state=${state}`,
    );

    expect(savedTokens.length).toBe(1);
    expect(savedTokens[0].input.metadata?.name).toBe("Jane Doe");
  });
});

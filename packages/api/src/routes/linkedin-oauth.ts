/**
 * LinkedIn OAuth routes.
 *
 * Security design for the callback route:
 * The LinkedIn authorization server redirects the user's browser to the
 * callback URL AFTER they approve the app. At that point, the browser has no
 * admin_session cookie on the request (the redirect originates from LinkedIn's
 * servers, not from a page that already holds the cookie). Therefore the
 * callback CANNOT be behind the session cookie gate.
 *
 * Instead, security is provided by the state parameter:
 *   - POST /start generates a cryptographically random 32-byte state, stores it
 *     in Redis with a 10-minute TTL, and returns the authorize URL.
 *   - GET /callback reads the state from Redis (consume-once: GET + DEL). A
 *     missing or already-consumed state is rejected with a 302 error redirect.
 *     This CSRF protection means the callback is as safe as the state secret.
 *
 * Mounting strategy in app.ts:
 *   1. createLinkedInOAuthRouter  → mount INSIDE adminApp (behind requireAuth).
 *      Handles: POST /start, GET /status.
 *   2. createLinkedInOAuthCallbackRouter → mount OUTSIDE adminApp at the full
 *      path /api/admin/social-credentials/linkedin/oauth/callback.
 *      Handles: GET /  (the callback itself).
 *
 * The split into two exported routers makes the gate exemption explicit and
 * avoids any path-pattern exemption on the shared gate middleware.
 */

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { createLogger } from "@newsletter/shared/logger";
import {
  isTenantContext,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import type { AppCredentialsRepo } from "@api/repositories/app-credentials.js";
import type { SocialTokensRepo } from "@api/repositories/social-tokens.js";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { resolveLinkedInClient } from "@api/services/linkedin-credential-resolver.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
} from "@api/services/linkedin-oauth.js";

// Redis sub-interface used by these routes (read, write, delete).
export interface OAuthRedis {
  set(key: string, value: string, exMode: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export interface LinkedInOAuthRouterDeps {
  /**
   * App-level store (P12, REQ-080): every tenant connects through the SHARED
   * LinkedIn OAuth client held in `app_credentials` — super-admin-managed,
   * never the tenant's own rows.
   */
  getAppCredsRepo: () => Pick<AppCredentialsRepo, "getLinkedInClient" | "getStatus">;
  /**
   * Tenant-scoped token repo: the OAuth tokens themselves belong to ONE
   * tenant (REQ-080/083). The start route derives the scope from the session;
   * the callback re-derives it from the tenant id carried by the Redis state
   * (the callback has no session — see module JSDoc).
   */
  getTokenRepo: (scope?: TenantScope) => SocialTokensRepo;
  redis: OAuthRedis;
  /** Process env (for PUBLIC_BASE_URL and env-fallback credentials). */
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = "linkedin:oauth:state:";

const oauthLog = createLogger("linkedin-oauth");

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

function buildRedirectUri(env: Record<string, string | undefined>): string {
  const base = env.PUBLIC_BASE_URL ?? "";
  return `${base}/api/admin/social-credentials/linkedin/oauth/callback`;
}

function settingsRedirectUrl(
  env: Record<string, string | undefined>,
  params: Record<string, string>,
): string {
  const base = env.PUBLIC_BASE_URL ?? "";
  const qs = new URLSearchParams(params).toString();
  // Redirect to /admin/settings on the web frontend (same domain in production).
  // In tests PUBLIC_BASE_URL points to the server; the redirect is a simple
  // relative path resolution. The frontend handles the ?linkedin= query param.
  return `${base}/admin/settings?${qs}`;
}

/**
 * Admin-gated routes: POST /start, GET /status.
 * Mount this inside adminApp (behind requireAuth).
 */
export function createLinkedInOAuthRouter(
  deps: LinkedInOAuthRouterDeps,
): Hono {
  const app = new Hono();

  // POST /start → resolve the shared app client, generate state, store in
  // Redis, return authorize URL.
  app.post("/start", async (c) => {
    const creds = await resolveLinkedInClient({
      repo: deps.getAppCredsRepo(),
      env: deps.env as NodeJS.ProcessEnv,
    });

    if (creds === null) {
      return c.json({ error: "client_not_configured" }, 409);
    }

    const state = randomBytes(32).toString("hex");
    const redirectUri = buildRedirectUri(deps.env as Record<string, string | undefined>);

    // Store state in Redis (consume-once CSRF token). The value carries the
    // STARTING tenant's id so the session-less callback can store the tokens
    // under the right tenant (P12, REQ-080); legacy/unscoped sessions store
    // the pre-P12 "1" sentinel (single-tenant bridge applies on callback).
    const scope = tenantScopeFromContext(c);
    const stateValue = isTenantContext(scope) ? scope.tenantId : "1";
    await deps.redis.set(stateKey(state), stateValue, "EX", STATE_TTL_SECONDS);

    const authorizeUrl = buildAuthorizeUrl({
      clientId: creds.clientId,
      redirectUri,
      state,
    });

    return c.json({ authorizeUrl });
  });

  // GET /status → reports full LinkedIn connection status (REQ-011).
  // clientConfigured reflects the SHARED app client; connected/connectedAs is
  // the calling tenant's own token (REQ-080, never another tenant's).
  app.get("/status", async (c) => {
    const appStatus = await deps.getAppCredsRepo().getStatus();

    const tokenRepo = deps.getTokenRepo(tenantScopeFromContext(c));
    const tokenRow = await tokenRepo.getLinkedIn().catch(() => null);

    const connected = tokenRow !== null;
    const connectedAs = tokenRow?.metadata?.name ?? null;
    const expiresAt = tokenRow ? tokenRow.expiresAt.toISOString() : null;
    // refreshToken is empty string sentinel when no refresh token was issued (REQ-014).
    const rt = tokenRow?.refreshToken;
    const hasRefreshToken = connected && rt !== "" && rt !== null;

    return c.json({
      clientConfigured: appStatus.linkedinClient.configured,
      connected,
      connectedAs,
      expiresAt,
      hasRefreshToken,
    });
  });

  return app;
}

/**
 * Public (ungated) callback router: GET / .
 * Mount this OUTSIDE adminApp at the full path
 * /api/admin/social-credentials/linkedin/oauth/callback.
 *
 * Security is entirely provided by the unguessable Redis-stored state CSRF
 * token (consume-once). See module JSDoc for the design rationale.
 */
export function createLinkedInOAuthCallbackRouter(
  deps: LinkedInOAuthRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const env = deps.env as Record<string, string | undefined>;
    const code = c.req.query("code");
    const state = c.req.query("state");
    const linkedinError = c.req.query("error");

    oauthLog.info(
      {
        event: "linkedin.callback.hit",
        hasCode: code !== undefined,
        hasState: state !== undefined,
        linkedinError: linkedinError ?? null,
        linkedinErrorDescription: c.req.query("error_description") ?? null,
      },
      "linkedin oauth callback hit",
    );

    const errorRedirect = (reason: string): Response => {
      oauthLog.warn(
        { event: "linkedin.callback.error_redirect", reason },
        "linkedin oauth callback redirecting with error",
      );
      return c.redirect(settingsRedirectUrl(env, { linkedin: "error", reason }));
    };

    // LinkedIn rejected the authorize request (e.g. unregistered redirect_uri,
    // user denied). It redirects back with ?error= and no code.
    if (linkedinError !== undefined) {
      return errorRedirect("linkedin_denied");
    }

    // Validate CSRF state — consume once.
    if (!state) {
      return errorRedirect("state");
    }
    const storedValue = await deps.redis.get(stateKey(state));
    if (!storedValue) {
      return errorRedirect("state");
    }
    // Consume the state immediately so it cannot be replayed.
    await deps.redis.del(stateKey(state));

    if (!code) {
      return errorRedirect("state");
    }

    // The state value carries the STARTING tenant's id (P12, REQ-080) — the
    // callback has no session, so this is how the tokens land under the right
    // tenant. The legacy "1" sentinel falls back to the wiring's default
    // scope (single-tenant bridge).
    const tokenScope: TenantScope | undefined =
      storedValue === "1"
        ? undefined
        : { tenantId: storedValue, role: "tenant_admin" };

    // Resolve the shared app client (needed for token exchange).
    const creds = await resolveLinkedInClient({
      repo: deps.getAppCredsRepo(),
      env: deps.env as NodeJS.ProcessEnv,
    });
    if (creds === null) {
      return errorRedirect("exchange");
    }

    const redirectUri = buildRedirectUri(env);
    const fetchFn = deps.fetchFn ?? fetch;

    // Exchange authorization code for tokens.
    const exchangeResult = await exchangeCode(
      {
        code,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri,
      },
      fetchFn,
    );
    if (!exchangeResult.ok) {
      oauthLog.error(
        { event: "linkedin.callback.exchange_failed" },
        "linkedin token exchange failed",
      );
      return errorRedirect("exchange");
    }

    oauthLog.info(
      {
        event: "linkedin.callback.exchange_ok",
        hasRefreshToken: exchangeResult.parsed.refreshToken !== "",
        expiresAt: exchangeResult.parsed.expiresAt.toISOString(),
      },
      "linkedin token exchange succeeded",
    );

    // Fetch userinfo to get personUrn.
    const userInfoResult = await fetchUserInfo(
      exchangeResult.parsed.accessToken,
      fetchFn,
    );
    if (!userInfoResult.ok) {
      return errorRedirect("userinfo");
    }

    const personUrn = `urn:li:person:${userInfoResult.userInfo.sub}`;
    const displayName = userInfoResult.userInfo.name ?? null;

    // Persist encrypted token UNDER THE STARTING TENANT (REQ-080). The cipher
    // is baked into the repo factory (injected via deps.getTokenRepo); this
    // route does not handle encryption directly.
    const tokenRepo = deps.getTokenRepo(tokenScope);
    await tokenRepo.saveToken("linkedin", {
      accessToken: exchangeResult.parsed.accessToken,
      refreshToken: exchangeResult.parsed.refreshToken,
      expiresAt: exchangeResult.parsed.expiresAt,
      metadata: {
        personUrn,
        ...(displayName !== null ? { name: displayName } : {}),
      },
    });

    oauthLog.info(
      {
        event: "linkedin.callback.connected",
        personUrn,
        name: displayName,
        hasRefreshToken: exchangeResult.parsed.refreshToken !== "",
      },
      "linkedin oauth connected; token saved",
    );

    return c.redirect(settingsRedirectUrl(env, { linkedin: "connected" }));
  });

  return app;
}


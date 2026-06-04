/**
 * LinkedIn OAuth routes.
 *
 * Security design for the callback route:
 * The LinkedIn authorization server redirects the user's browser to the
 * callback URL AFTER they approve the app. At that point, the browser has no
 * admin_session cookie on the request (the redirect originates from LinkedIn's
 * servers, not from a page that already holds the cookie). Therefore the
 * callback CANNOT be behind requireAdmin.
 *
 * Instead, security is provided by the state parameter:
 *   - POST /start generates a cryptographically random 32-byte state, stores it
 *     in Redis with a 10-minute TTL, and returns the authorize URL.
 *   - GET /callback reads the state from Redis (consume-once: GET + DEL). A
 *     missing or already-consumed state is rejected with a 302 error redirect.
 *     This CSRF protection means the callback is as safe as the state secret.
 *
 * Mounting strategy in app.ts:
 *   1. createLinkedInOAuthRouter  → mount INSIDE adminApp (behind requireAdmin).
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
import type { SocialCredentialsRepo } from "@api/repositories/social-credentials.js";
import type { SocialTokensRepo } from "@api/repositories/social-tokens.js";
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
  getCredRepo: () => SocialCredentialsRepo;
  getTokenRepo: () => SocialTokensRepo;
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
 * Mount this inside adminApp (behind requireAdmin).
 */
export function createLinkedInOAuthRouter(
  deps: LinkedInOAuthRouterDeps,
): Hono {
  const app = new Hono();

  // POST /start → resolve client creds, generate state, store in Redis, return authorize URL.
  app.post("/start", async (c) => {
    const credRepo = deps.getCredRepo();
    const creds = await resolveLinkedInClient({
      repo: credRepo,
      env: deps.env as NodeJS.ProcessEnv,
    });

    if (creds === null) {
      return c.json({ error: "client_not_configured" }, 409);
    }

    const state = randomBytes(32).toString("hex");
    const redirectUri = buildRedirectUri(deps.env as Record<string, string | undefined>);

    // Store state in Redis (consume-once CSRF token).
    await deps.redis.set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);

    const authorizeUrl = buildAuthorizeUrl({
      clientId: creds.clientId,
      redirectUri,
      state,
    });

    return c.json({ authorizeUrl });
  });

  // GET /status → reports full LinkedIn connection status (REQ-011).
  app.get("/status", async (c) => {
    const credRepo = deps.getCredRepo();
    const status = await credRepo.getStatus();

    const tokenRepo = deps.getTokenRepo();
    const tokenRow = await tokenRepo.getLinkedIn().catch(() => null);

    const connected = tokenRow !== null;
    const connectedAs = tokenRow?.metadata?.name ?? null;
    const expiresAt = tokenRow ? tokenRow.expiresAt.toISOString() : null;
    // refreshToken is empty string sentinel when no refresh token was issued (REQ-014).
    const rt = tokenRow?.refreshToken;
    const hasRefreshToken = connected && rt !== "" && rt !== null;

    return c.json({
      clientConfigured: status.linkedin.configured,
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

    // Resolve client credentials (needed for token exchange).
    const credRepo = deps.getCredRepo();
    const creds = await resolveLinkedInClient({
      repo: credRepo,
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

    // Persist encrypted token. The cipher is baked into the repo factory
    // (injected via deps.getTokenRepo); this route does not handle encryption directly.
    const tokenRepo = deps.getTokenRepo();
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


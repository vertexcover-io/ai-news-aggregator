/**
 * Twitter OAuth2 routes.
 *
 * Security design mirrors LinkedIn OAuth (D-001):
 * The Twitter authorization server redirects the user's browser to the callback
 * URL AFTER they approve the app. At that point, the browser has no admin_session
 * cookie. Therefore the callback CANNOT be behind requireAdmin.
 *
 * Security is provided by the state parameter:
 *   - POST /start generates a cryptographically random state + PKCE codeVerifier,
 *     stores them in Redis with a 10-minute TTL, and returns the authorize URL.
 *   - GET /callback reads state + codeVerifier from Redis (consume-once: GET + DEL).
 *     A missing or already-consumed state is rejected with a redirect error.
 *
 * Mounting strategy (see app.ts):
 *   1. createTwitterOAuthRouter → mount INSIDE adminApp (behind requireAdmin).
 *      Handles: POST /start, GET /status.
 *   2. createTwitterOAuthCallbackRouter → mount OUTSIDE adminApp at the full
 *      path /api/admin/social-credentials/twitter/oauth/callback.
 *      Handles: GET / (the callback itself).
 */

import { Hono } from "hono";
import { TwitterApi } from "twitter-api-v2";
import { createLogger } from "@newsletter/shared/logger";
import type { SocialTokensRepo } from "@api/repositories/social-tokens.js";
import type { SocialCredentialsRepo } from "@api/repositories/social-credentials.js";
import {
  buildTwitterOAuth2AuthLink,
  parseTwitterTokenResponse,
} from "@api/services/twitter-oauth.js";

// Redis sub-interface used by these routes.
export interface OAuthRedis {
  set(key: string, value: string, exMode: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export interface TwitterOAuth2AppCreds {
  clientId: string;
  clientSecret: string;
}

export type ResolveTwitterOAuth2AppFn = () => Promise<TwitterOAuth2AppCreds | null>;

export interface TwitterOAuthRouterDeps {
  getCredRepo: () => SocialCredentialsRepo;
  getTokenRepo: () => SocialTokensRepo;
  redis: OAuthRedis;
  /** Process env (for PUBLIC_BASE_URL). */
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Resolves app-level Twitter OAuth2 client id/secret from app_credentials table. */
  resolveTwitterOAuth2App: ResolveTwitterOAuth2AppFn;
}

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = "twitter:oauth:state:";
const CODE_VERIFIER_KEY_PREFIX = "twitter:oauth:codeverifier:";

const oauthLog = createLogger("twitter-oauth");

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

function codeVerifierKey(state: string): string {
  return `${CODE_VERIFIER_KEY_PREFIX}${state}`;
}

function buildRedirectUri(env: Record<string, string | undefined>): string {
  const base = env.PUBLIC_BASE_URL ?? "";
  return `${base}/api/admin/social-credentials/twitter/oauth/callback`;
}

function settingsRedirectUrl(
  env: Record<string, string | undefined>,
  params: Record<string, string>,
): string {
  const base = env.PUBLIC_BASE_URL ?? "";
  const qs = new URLSearchParams(params).toString();
  return `${base}/admin/settings?${qs}`;
}

/**
 * Admin-gated routes: POST /start, GET /status.
 * Mount this inside adminApp (behind requireAdmin).
 */
export function createTwitterOAuthRouter(
  deps: TwitterOAuthRouterDeps,
): Hono {
  const app = new Hono();

  // POST /start → resolve app creds, generate OAuth2 auth link, store PKCE in Redis.
  app.post("/start", async (c) => {
    const appCreds = await deps.resolveTwitterOAuth2App();
    if (appCreds === null) {
      return c.json({ error: "client_not_configured" }, 409);
    }

    const redirectUri = buildRedirectUri(deps.env as Record<string, string | undefined>);
    const { url, codeVerifier, state } = buildTwitterOAuth2AuthLink({
      clientId: appCreds.clientId,
      clientSecret: appCreds.clientSecret,
      redirectUri,
    });

    // Store state and codeVerifier in Redis (consume-once CSRF + PKCE).
    await deps.redis.set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);
    await deps.redis.set(codeVerifierKey(state), codeVerifier, "EX", STATE_TTL_SECONDS);

    return c.json({ authorizeUrl: url });
  });

  // GET /status → reports Twitter OAuth2 connection status (REQ-081).
  app.get("/status", async (c) => {
    const credRepo = deps.getCredRepo();
    const status = await credRepo.getStatus();

    const tokenRepo = deps.getTokenRepo();
    const tokenRow = await tokenRepo.getTwitter().catch(() => null);

    const connected = tokenRow !== null;
    const connectedAs = tokenRow?.metadata?.name ?? null;
    const expiresAt = tokenRow ? tokenRow.expiresAt.toISOString() : null;
    const rt = tokenRow?.refreshToken;
    const hasRefreshToken = connected && rt !== "" && rt !== null;

    return c.json({
      clientConfigured: status.twitter.configured,
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
 * /api/admin/social-credentials/twitter/oauth/callback.
 */
export function createTwitterOAuthCallbackRouter(
  deps: TwitterOAuthRouterDeps,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const env = deps.env as Record<string, string | undefined>;
    const code = c.req.query("code");
    const state = c.req.query("state");
    const twitterError = c.req.query("error");

    oauthLog.info(
      {
        event: "twitter.callback.hit",
        hasCode: code !== undefined,
        hasState: state !== undefined,
        twitterError: twitterError ?? null,
      },
      "twitter oauth callback hit",
    );

    const errorRedirect = (reason: string): Response => {
      oauthLog.warn(
        { event: "twitter.callback.error_redirect", reason },
        "twitter oauth callback redirecting with error",
      );
      return c.redirect(settingsRedirectUrl(env, { twitter: "error", reason }));
    };

    // Twitter rejected the authorize request (e.g. user denied).
    if (twitterError !== undefined) {
      return errorRedirect("twitter_denied");
    }

    // Validate CSRF state — consume once.
    if (!state) {
      return errorRedirect("state");
    }
    const stateValue = await deps.redis.get(stateKey(state));
    if (!stateValue) {
      return errorRedirect("state");
    }
    // Consume state + codeVerifier immediately.
    await deps.redis.del(stateKey(state));
    const codeVerifier = await deps.redis.get(codeVerifierKey(state));
    if (codeVerifier) {
      await deps.redis.del(codeVerifierKey(state));
    }

    if (!code) {
      return errorRedirect("state");
    }
    if (!codeVerifier) {
      oauthLog.error(
        { event: "twitter.callback.missing_codeverifier", hasState: true },
        "codeVerifier missing from Redis — PKCE cannot complete",
      );
      return errorRedirect("exchange");
    }

    // Resolve app-level OAuth2 client credentials.
    const appCreds = await deps.resolveTwitterOAuth2App();
    if (appCreds === null) {
      return errorRedirect("exchange");
    }

    const redirectUri = buildRedirectUri(env);

    // Exchange authorization code for tokens using twitter-api-v2.
    let parsed: { accessToken: string; refreshToken: string | null; expiresAt: Date };
    try {
      const twitterClient = new TwitterApi({
        clientId: appCreds.clientId,
        clientSecret: appCreds.clientSecret,
      });
      const loginResult = await twitterClient.loginWithOAuth2({
        code,
        codeVerifier,
        redirectUri,
      });
      parsed = parseTwitterTokenResponse(loginResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      oauthLog.error(
        { event: "twitter.callback.exchange_failed", error: message },
        "twitter token exchange failed",
      );
      return errorRedirect("exchange");
    }

    oauthLog.info(
      {
        event: "twitter.callback.exchange_ok",
        hasRefreshToken: parsed.refreshToken !== null,
        expiresAt: parsed.expiresAt.toISOString(),
      },
      "twitter token exchange succeeded",
    );

    // Fetch username via the authenticated client.
    let username: string | null = null;
    try {
      const loggedClient = new TwitterApi(parsed.accessToken);
      const me = await loggedClient.v2.me();
      username = me.data.username;
    } catch {
      // Non-fatal: we still persist the token.
      oauthLog.warn(
        { event: "twitter.callback.me_failed" },
        "twitter v2.me() failed; persisting token without username",
      );
    }

    // Persist encrypted token.
    const tokenRepo = deps.getTokenRepo();
    await tokenRepo.saveToken("twitter", {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      metadata: username ? { name: username } : null,
    });

    oauthLog.info(
      {
        event: "twitter.callback.connected",
        username: username ?? null,
        hasRefreshToken: parsed.refreshToken !== null,
      },
      "twitter oauth connected; token saved",
    );

    return c.redirect(settingsRedirectUrl(env, { twitter: "connected" }));
  });

  return app;
}

/**
 * Twitter OAuth2 routes (P13, REQ-081) — mirror of linkedin-oauth.ts.
 *
 * Security design for the callback route (D-001, same as LinkedIn):
 * Twitter's authorization server redirects the user's browser to the callback
 * AFTER they approve the app — no admin_session cookie is present on that
 * redirect, so the callback cannot sit behind the cookie gate. Security is
 * the Redis-stored state instead:
 *   - POST /start runs `generateOAuth2AuthLink` (PKCE) and stores
 *     `{ codeVerifier, tenantId }` under the provider-generated state with a
 *     10-minute TTL. The tenantId is the STARTING tenant's — that is how the
 *     session-less callback knows which tenant the tokens belong to.
 *   - GET /callback reads the state from Redis (consume-once: GET + DEL),
 *     exchanges the code via `loginWithOAuth2`, and stores the encrypted
 *     tokens under `(tenantId, 'twitter')` (P12 social-tokens repo).
 *
 * Mounting strategy in app.ts (identical split to LinkedIn):
 *   1. createTwitterOAuthRouter         → INSIDE adminApp (behind requireAuth).
 *      Handles: POST /start, GET /status.
 *   2. createTwitterOAuthCallbackRouter → OUTSIDE adminApp at the full path
 *      /api/admin/social-credentials/twitter/oauth/callback.
 */

import { Hono } from "hono";
import { createLogger } from "@newsletter/shared/logger";
import {
  isTenantContext,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import type { AppCredentialsRepo } from "@api/repositories/app-credentials.js";
import type { SocialTokensRepo } from "@api/repositories/social-tokens.js";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import { resolveTwitterClient } from "@api/services/twitter-client-resolver.js";
import {
  createTwitterOAuthProvider,
  type TwitterOAuthProvider,
} from "@api/services/twitter-oauth.js";
import type { OAuthRedis } from "@api/routes/linkedin-oauth.js";

export interface TwitterOAuthRouterDeps {
  /**
   * App-level store (P12/P13, REQ-081): every tenant connects through the
   * SHARED Twitter OAuth2 client held in `app_credentials` — super-admin
   * managed, never the tenant's own rows.
   */
  getAppCredsRepo: () => Pick<AppCredentialsRepo, "getTwitterClient" | "getStatus">;
  /**
   * Tenant-scoped token repo: the OAuth tokens belong to ONE tenant. The
   * start route derives the scope from the session; the callback re-derives
   * it from the tenant id carried by the Redis state.
   */
  getTokenRepo: (scope?: TenantScope) => Pick<SocialTokensRepo, "saveToken" | "getTwitter">;
  redis: OAuthRedis;
  /** Process env (for PUBLIC_BASE_URL and env-fallback client credentials). */
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Injectable OAuth provider for testing. Defaults to the twitter-api-v2 adapter. */
  provider?: TwitterOAuthProvider;
}

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = "twitter:oauth:state:";

/** Persisted under the state key: PKCE verifier + the starting tenant. */
interface TwitterOAuthStatePayload {
  codeVerifier: string;
  /** Starting tenant's id; the pre-P12 "1" sentinel for legacy/unscoped sessions. */
  tenantId: string;
}

const oauthLog = createLogger("twitter-oauth");

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
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
  // The frontend settings page handles the ?twitter= query param.
  return `${base}/admin/settings?${qs}`;
}

function parseStatePayload(raw: string): TwitterOAuthStatePayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "codeVerifier" in parsed &&
      typeof (parsed as { codeVerifier: unknown }).codeVerifier === "string" &&
      "tenantId" in parsed &&
      typeof (parsed as { tenantId: unknown }).tenantId === "string"
    ) {
      return parsed as unknown as TwitterOAuthStatePayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Admin-gated routes: POST /start, GET /status.
 * Mount this inside adminApp (behind requireAuth).
 */
export function createTwitterOAuthRouter(deps: TwitterOAuthRouterDeps): Hono {
  const app = new Hono();
  const provider = deps.provider ?? createTwitterOAuthProvider();

  // POST /start → resolve the shared app client, generate the PKCE auth link,
  // store { codeVerifier, tenantId } under the state in Redis, return the URL.
  app.post("/start", async (c) => {
    const creds = await resolveTwitterClient({
      repo: deps.getAppCredsRepo(),
      env: deps.env as NodeJS.ProcessEnv,
    });

    if (creds === null) {
      return c.json({ error: "client_not_configured" }, 409);
    }

    const redirectUri = buildRedirectUri(deps.env as Record<string, string | undefined>);
    const { url, codeVerifier, state } = provider.generateAuthLink({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri,
    });

    // The payload carries the STARTING tenant's id so the session-less
    // callback stores the tokens under the right tenant (P12 pattern);
    // legacy/unscoped sessions store the pre-P12 "1" sentinel.
    const scope = tenantScopeFromContext(c);
    const payload: TwitterOAuthStatePayload = {
      codeVerifier,
      tenantId: isTenantContext(scope) ? scope.tenantId : "1",
    };
    await deps.redis.set(
      stateKey(state),
      JSON.stringify(payload),
      "EX",
      STATE_TTL_SECONDS,
    );

    return c.json({ authorizeUrl: url });
  });

  // GET /status → connected + token expiry for the CALLING tenant only.
  app.get("/status", async (c) => {
    const appStatus = await deps.getAppCredsRepo().getStatus();

    const tokenRepo = deps.getTokenRepo(tenantScopeFromContext(c));
    const tokenRow = await tokenRepo.getTwitter().catch(() => null);

    const connected = tokenRow !== null;
    const connectedAs = tokenRow?.metadata?.name ?? null;
    const expiresAt = tokenRow ? tokenRow.expiresAt.toISOString() : null;
    // refreshToken is the empty-string sentinel when none was issued.
    const rt = tokenRow?.refreshToken;
    const hasRefreshToken = connected && rt !== "" && rt !== null;

    return c.json({
      clientConfigured: appStatus.twitterClient.configured,
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
 *
 * Security is entirely provided by the unguessable Redis-stored state
 * (consume-once) + the PKCE code verifier it carries. See module JSDoc.
 */
export function createTwitterOAuthCallbackRouter(
  deps: TwitterOAuthRouterDeps,
): Hono {
  const app = new Hono();
  const provider = deps.provider ?? createTwitterOAuthProvider();

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

    // Twitter rejected the authorize request (user denied, bad client config).
    if (twitterError !== undefined) {
      return errorRedirect("twitter_denied");
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

    const payload = parseStatePayload(storedValue);
    if (payload === null || !code) {
      return errorRedirect("state");
    }

    // The state payload carries the STARTING tenant's id — the callback has
    // no session, so this is how the tokens land under the right tenant. The
    // legacy "1" sentinel falls back to the wiring's default scope.
    const tokenScope: TenantScope | undefined =
      payload.tenantId === "1"
        ? undefined
        : { tenantId: payload.tenantId, role: "tenant_admin" };

    // Resolve the shared app client (needed for the token exchange).
    const creds = await resolveTwitterClient({
      repo: deps.getAppCredsRepo(),
      env: deps.env as NodeJS.ProcessEnv,
    });
    if (creds === null) {
      return errorRedirect("exchange");
    }

    const redirectUri = buildRedirectUri(env);
    const exchangeResult = await provider.exchangeCode({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      code,
      codeVerifier: payload.codeVerifier,
      redirectUri,
    });
    if (!exchangeResult.ok) {
      oauthLog.error(
        { event: "twitter.callback.exchange_failed" },
        "twitter token exchange failed",
      );
      return errorRedirect("exchange");
    }

    // Persist the encrypted token UNDER THE STARTING TENANT (REQ-081). The
    // cipher is baked into the repo factory (injected via deps.getTokenRepo).
    const tokenRepo = deps.getTokenRepo(tokenScope);
    await tokenRepo.saveToken("twitter", {
      accessToken: exchangeResult.accessToken,
      refreshToken: exchangeResult.refreshToken,
      expiresAt: exchangeResult.expiresAt,
      metadata:
        exchangeResult.username !== null ? { name: exchangeResult.username } : null,
    });

    oauthLog.info(
      {
        event: "twitter.callback.connected",
        username: exchangeResult.username,
        hasRefreshToken: exchangeResult.refreshToken !== null,
        expiresAt: exchangeResult.expiresAt.toISOString(),
      },
      "twitter oauth connected; token saved",
    );

    return c.redirect(settingsRedirectUrl(env, { twitter: "connected" }));
  });

  return app;
}

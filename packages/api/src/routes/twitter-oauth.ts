/**
 * Twitter OAuth2 PKCE routes (REQ-081).
 *
 * Mirrors the LinkedIn OAuth security design (see linkedin-oauth.ts):
 *   - POST /start (session-gated) stores {tenantId, codeVerifier} in Redis
 *     under the provider-generated state (consume-once, 10-minute TTL) and
 *     returns the authorize URL.
 *   - GET /callback is UNGATED (Twitter redirects the browser here with no
 *     session cookie). Security is the unguessable consume-once state; the
 *     token save binds to the STATE's tenant, never to any session.
 *
 * Mounting (mirror of LinkedIn in app.ts):
 *   1. createTwitterOAuthRouter        → inside adminApp (behind requireUser)
 *      at /social-credentials/twitter/oauth. Handles POST /start, GET /status,
 *      DELETE / (disconnect).
 *   2. createTwitterOAuthCallbackRouter → OUTSIDE adminApp at
 *      /api/admin/social-credentials/twitter/oauth/callback.
 *
 * Tenants connect Twitter ONLY via this flow — there is no manual API-key
 * entry for tenants (REQ-082). Status responses never contain token material
 * (NF6/REQ-125).
 */

import { Hono } from "hono";
import { createLogger } from "@newsletter/shared/logger";
import { getTenantId } from "@api/middleware/tenant-host.js";
import type { SocialTokensRepo } from "@api/repositories/social-tokens.js";
import {
  resolveTwitterOAuthAppCreds,
  type TwitterOAuthAppCreds,
  type TwitterOAuthService,
} from "@api/services/twitter-oauth.js";
import type { OAuthRedis } from "@api/routes/linkedin-oauth.js";

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = "twitter:oauth:state:";

const oauthLog = createLogger("twitter-oauth");

export interface TwitterOAuthRouterDeps {
  getTokenRepo: (tenantId: string) => SocialTokensRepo;
  redis: OAuthRedis;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Builds the OAuth2 client; index.ts injects the twitter-api-v2 ctor. */
  oauthServiceFactory: (creds: TwitterOAuthAppCreds) => TwitterOAuthService;
}

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
  return `${base}/admin/settings?${qs}`;
}

/**
 * Session-gated routes: POST /start, GET /status, DELETE / (disconnect).
 * Mount inside adminApp (behind requireUser).
 */
export function createTwitterOAuthRouter(deps: TwitterOAuthRouterDeps): Hono {
  const app = new Hono();

  app.post("/start", async (c) => {
    const tenantId = getTenantId(c);
    const creds = resolveTwitterOAuthAppCreds(
      deps.env as Record<string, string | undefined>,
    );
    if (creds === null) {
      return c.json({ error: "client_not_configured" }, 409);
    }

    const redirectUri = buildRedirectUri(
      deps.env as Record<string, string | undefined>,
    );
    const link = deps.oauthServiceFactory(creds).generateAuthLink(redirectUri);

    // Consume-once CSRF state. The blob carries the initiating tenant and the
    // PKCE verifier: the callback has no session, so this binds the token
    // save to the right tenant (REQ-081).
    await deps.redis.set(
      stateKey(link.state),
      JSON.stringify({ tenantId, codeVerifier: link.codeVerifier }),
      "EX",
      STATE_TTL_SECONDS,
    );

    return c.json({ authorizeUrl: link.url });
  });

  // Connection status — never includes token material (NF6).
  app.get("/status", async (c) => {
    const tenantId = getTenantId(c);
    const clientConfigured =
      resolveTwitterOAuthAppCreds(
        deps.env as Record<string, string | undefined>,
      ) !== null;

    const row = await deps.getTokenRepo(tenantId).getToken("twitter");
    const connected = row !== null;
    const rt = row?.refreshToken;

    return c.json({
      clientConfigured,
      connected,
      connectedAs: row?.metadata?.name ?? null,
      expiresAt: row ? row.expiresAt.toISOString() : null,
      hasRefreshToken: connected && rt !== "" && rt !== null,
    });
  });

  // Disconnect: remove this tenant's Twitter OAuth token.
  app.delete("/", async (c) => {
    const tenantId = getTenantId(c);
    const removed = await deps.getTokenRepo(tenantId).deleteToken("twitter");
    return c.json({ ok: true, removed });
  });

  return app;
}

/**
 * Public (ungated) callback router: GET /.
 * Mount OUTSIDE adminApp at the full path
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

    const errorRedirect = (reason: string): Response => {
      oauthLog.warn(
        { event: "twitter.callback.error_redirect", reason },
        "twitter oauth callback redirecting with error",
      );
      return c.redirect(settingsRedirectUrl(env, { twitter: "error", reason }));
    };

    // Twitter rejected the authorize request (user denied, bad client).
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
    await deps.redis.del(stateKey(state));

    let tenantId: string;
    let codeVerifier: string;
    try {
      const blob = JSON.parse(storedValue) as {
        tenantId?: unknown;
        codeVerifier?: unknown;
      };
      if (
        typeof blob.tenantId !== "string" ||
        typeof blob.codeVerifier !== "string"
      ) {
        return errorRedirect("state");
      }
      tenantId = blob.tenantId;
      codeVerifier = blob.codeVerifier;
    } catch {
      return errorRedirect("state");
    }

    if (!code) {
      return errorRedirect("state");
    }

    const creds = resolveTwitterOAuthAppCreds(env);
    if (creds === null) {
      return errorRedirect("exchange");
    }

    const exchange = await deps.oauthServiceFactory(creds).exchangeCode({
      code,
      codeVerifier,
      redirectUri: buildRedirectUri(env),
    });
    if (!exchange.ok) {
      oauthLog.error(
        { event: "twitter.callback.exchange_failed" },
        "twitter token exchange failed",
      );
      return errorRedirect("exchange");
    }

    // Persist encrypted token under the STATE's tenant (REQ-081/REQ-083).
    await deps.getTokenRepo(tenantId).saveToken("twitter", {
      accessToken: exchange.tokens.accessToken,
      refreshToken: exchange.tokens.refreshToken,
      expiresAt: exchange.tokens.expiresAt,
      metadata:
        exchange.tokens.connectedAs !== null
          ? { name: exchange.tokens.connectedAs }
          : null,
    });

    oauthLog.info(
      {
        event: "twitter.callback.connected",
        connectedAs: exchange.tokens.connectedAs,
        hasRefreshToken: exchange.tokens.refreshToken !== null,
        expiresAt: exchange.tokens.expiresAt.toISOString(),
      },
      "twitter oauth connected; token saved",
    );

    return c.redirect(settingsRedirectUrl(env, { twitter: "connected" }));
  });

  return app;
}

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context, MiddlewareHandler } from "hono";
import { captureException } from "@api/lib/posthog.js";
import { blockPublicContentOnAppHost } from "@api/middleware/resolve-tenant.js";

export interface BuildAppDeps {
  sessionSecret: string;
  publicArchivesRouter: Hono;
  publicHomeRouter: Hono;
  publicMustReadRouter: Hono;
  archivesSearchRouter: Hono;
  publicSourcesRouter: Hono;
  adminArchivesRouter: Hono;
  adminRunsRouter: Hono;
  adminEvalRouter: Hono;
  adminSocialCredentialsRouter: Hono;
  adminMustReadRouter: Hono;
  runsRouter: Hono;
  settingsRouter: Hono;
  /**
   * Per-user auth routes (P3): POST /signup|login|logout|forgot|reset +
   * GET /me. Mounted at /api/auth OUTSIDE the cookie gate — these routes
   * create/destroy the session. Rate-limited internally (REQ-121).
   */
  authRouter: Hono;
  /**
   * Chrome extension API (P-ext): POST /login + POST /submissions. Mounted at
   * /api/extension OUTSIDE the cookie gate — it carries its own `ext|` bearer
   * auth and CORS scoped to `chrome-extension://`. Optional ONLY so existing
   * unit tests composing buildApp keep working — index.ts always provides it.
   */
  extensionRouter?: Hono;
  requireAuthFactory: (secret: string) => MiddlewareHandler;
  subscribeRouter: Hono;
  webhooksRouter: Hono;
  analyticsRouter: Hono;
  analyticsConfigRouter: Hono;
  /**
   * Admin-gated LinkedIn OAuth routes (POST /start, GET /status).
   * Mounted inside adminApp — behind requireAuth.
   */
  linkedInOAuthRouter: Hono;
  /**
   * Public (ungated) LinkedIn OAuth callback router (GET /).
   * LinkedIn redirects the browser here after authorization; no admin cookie
   * is present on the redirect. Security is the Redis-stored CSRF state token.
   * Mounted BEFORE adminApp so the gate does not intercept this path.
   */
  linkedInOAuthCallbackRouter: Hono;
  /**
   * Admin-gated Twitter OAuth2 routes (POST /start, GET /status) (P13,
   * REQ-081). Mounted inside adminApp — behind requireAuth. Optional ONLY so
   * existing unit tests composing buildApp keep working — index.ts always
   * provides it.
   */
  twitterOAuthRouter?: Hono;
  /**
   * Public (ungated) Twitter OAuth2 callback router (GET /). Twitter
   * redirects the browser here after authorization; no admin cookie is
   * present on the redirect. Security is the Redis-stored consume-once state
   * carrying the PKCE code verifier (D-001 pattern). Mounted BEFORE adminApp.
   */
  twitterOAuthCallbackRouter?: Hono;
  /** Admin-gated collector health check trigger + snapshot routes. */
  collectorHealthRouter: Hono;
  /**
   * Host→tenant resolver (P5, REQ-020/021/022/023). Mounted on every /api
   * route BEFORE the routers: app-host requests pass through (tenant comes
   * from the session via requireAuth), `<slug>.<root>` / custom-domain
   * requests get a role-less `publicTenant` context var, unknown hosts get a
   * generic 404, and renamed slugs 301-redirect. Optional ONLY so existing
   * unit tests composing buildApp keep the legacy single-tenant behavior —
   * index.ts always provides it.
   */
  resolveTenant?: MiddlewareHandler;
  /**
   * Public tenant branding routes (P7, REQ-040/043): GET / (TenantBranding
   * payload) + GET /logo (Postgres-stored logo bytes with cache headers).
   * Mounted at /api/branding, ungated — branding is public-site chrome.
   * Optional ONLY so existing unit tests composing buildApp keep working —
   * index.ts always provides it.
   */
  brandingRouter?: Hono;
  /**
   * Super-admin console routes (P6, REQ-100/101/102/103): GET /tenants,
   * POST /impersonate/:tenantId, POST /impersonate/exit — mounted at
   * /api/super. The router applies requireSuperAdmin internally (see
   * routes/super-admin.ts). Optional ONLY so existing unit tests composing
   * buildApp keep working — index.ts always provides it.
   */
  superAdminRouter?: Hono;
  /**
   * Super-admin app-level credentials (P12, REQ-082/086): GET /, PUT
   * /linkedin-client, PUT /twitter-collector, DELETE /:key — mounted at
   * /api/super/app-credentials. The router applies requireSuperAdmin
   * internally. Optional ONLY so existing unit tests composing buildApp keep
   * working — index.ts always provides it.
   */
  superAppCredentialsRouter?: Hono;
  /**
   * Tenant source management (P8, REQ-070/072/074): GET/POST /api/sources +
   * PATCH/DELETE /api/sources/:id, auth-gated. Mounted on /api/sources AFTER
   * the public summary router, so GET /api/sources/summary stays public and
   * everything else on the path requires a session. Optional ONLY so existing
   * unit tests composing buildApp keep working — index.ts always provides it.
   */
  tenantSourcesRouter?: Hono;
  /**
   * Sending-domain routes (P14, REQ-084/085): GET/POST /api/settings/domain +
   * POST /api/settings/domain/verify, auth-gated. Mounted on its own path so
   * the settings router stays untouched. Optional ONLY so existing unit tests
   * composing buildApp keep working — index.ts always provides it.
   */
  sendingDomainRouter?: Hono;
  /**
   * Notification settings + feature flags (P16, REQ-092/093): GET/PUT
   * /api/settings/notifications + GET/PUT /api/settings/features,
   * auth-gated. Optional ONLY so existing unit tests composing buildApp keep
   * working — index.ts always provides it.
   */
  notificationSettingsRouter?: Hono;
  /**
   * Admin branding settings (FIX #1): GET/PUT /api/settings/branding +
   * GET/POST /api/settings/branding/logo, auth-gated. Optional ONLY so
   * existing unit tests composing buildApp keep working — index.ts always
   * provides it.
   */
  brandingSettingsRouter?: Hono;
  /**
   * Email-settings routes (Fix #3, Phase B): GET/PUT /api/settings/email,
   * auth-gated. Optional ONLY so existing unit tests composing buildApp keep
   * working — index.ts always provides it.
   */
  emailSettingsRouter?: Hono;
  /**
   * Custom web-domain routes (Fix #3, Phase C): GET/POST /api/admin/web-domain
   * + POST /verify, auth-gated. Optional ONLY so existing unit tests composing
   * buildApp keep working — index.ts always provides it.
   */
  webDomainRouter?: Hono;
  /**
   * Caddy on-demand TLS authorization (Fix #3, Phase C): GET
   * /internal/tls-allow?domain=… → 200 iff the host is a VERIFIED tenant
   * custom domain, else 403. Ungated + loopback-only in production (Caddy
   * calls it on 127.0.0.1); the DB allowlist is the abuse / LE-rate-limit
   * guard. Optional so existing buildApp unit tests keep working.
   */
  tlsAllow?: (domain: string) => Promise<boolean>;
  /**
   * Onboarding wizard routes (P11, REQ-030–038): GET/PATCH /api/onboarding,
   * slug-available, generate-prompts, discover-sources, activate — mounted
   * gated at /api/onboarding (the wizard is a tenant_admin surface).
   * Optional ONLY so existing unit tests composing buildApp keep working —
   * index.ts always provides it.
   */
  onboardingRouter?: Hono;
  /**
   * Feature-flag guard factory (Fix #4): wraps admin feature routes so a
   * tenant with the feature disabled gets `403 feature_disabled` instead of
   * the page's data. Optional ONLY so existing unit tests composing buildApp
   * keep working — index.ts always provides it.
   */
  requireFeature?: (
    flag: "featureEval" | "featureDeliverability" | "featureCanon",
  ) => MiddlewareHandler;
}

/**
 * Compose the full API Hono app.
 *
 * Route table (authoritative — see also index.ts):
 *
 *   Public:
 *     GET  /api/archives
 *     GET  /api/archives/:runId
 *     POST /api/auth/signup | /login | /logout | /forgot | /reset
 *     GET  /api/auth/me
 *
 *   Auth-gated (requireAuth — valid {userId,tenantId,role} session cookie):
 *     *    /api/admin/*
 *     *    /api/runs/*
 *     *    /api/settings
 */
export function buildApp(deps: BuildAppDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Caddy on-demand TLS authorization (Fix #3, Phase C): mounted BEFORE the
  // /api/* tenant middleware and ungated (Caddy calls it on loopback). Returns
  // 200 only for a verified tenant custom domain — the abuse / Let's-Encrypt
  // rate-limit guard.
  const tlsAllow = deps.tlsAllow;
  if (tlsAllow) {
    app.get("/internal/tls-allow", async (c) => {
      // Loopback-only: Caddy calls this on 127.0.0.1. If the peer address is
      // determinable and NOT loopback, refuse — defense-in-depth so the
      // endpoint can't be probed from off-box even if the port were exposed.
      if (!isLoopbackPeer(c)) return c.json({ ok: false }, 403);
      const domain = c.req.query("domain");
      if (domain === undefined || domain === "") {
        return c.json({ error: "domain required" }, 400);
      }
      const allowed = await tlsAllow(domain.trim().toLowerCase());
      return allowed ? c.json({ ok: true }) : c.json({ ok: false }, 403);
    });
  }

  // Host→tenant resolution runs before every /api route (P5): public routes
  // use the Host-derived tenant, admin routes keep the session tenant set by
  // requireAuth below (REQ-020/021/022).
  if (deps.resolveTenant) {
    app.use("/api/*", deps.resolveTenant);
    // The app host (platform admin/signup surface) has no public newsletter.
    // Without this guard its public CONTENT routes would resolve to an
    // undefined tenant scope — the legacy single-tenant path — and return
    // reviewed issues / sources merged across EVERY tenant. Gate them to a
    // generic 404 on the app host. Mounted together with the resolver so
    // genuine legacy single-tenant deploys (no resolver) stay unaffected.
    // Scoped to the public content paths only; the auth-gated tenant sources
    // management routes under /api/sources/:id keep working on the app host.
    for (const path of [
      "/api/home",
      "/api/home/*",
      "/api/archives",
      "/api/archives/*",
      "/api/must-read",
      "/api/must-read/*",
      "/api/sources/summary",
    ]) {
      app.use(path, blockPublicContentOnAppHost);
    }
  }

  // Public subscribe/confirm/unsubscribe routes.
  app.route("/api", deps.subscribeRouter);

  // Public SNS/SES webhook — no auth required.
  app.route("/api/webhooks", deps.webhooksRouter);

  // Public runtime analytics configuration for the browser SDK.
  app.route("/api/public/analytics-config", deps.analyticsConfigRouter);

  // Public archives. /search MUST be mounted before the public router so
  // it does not collide with the GET /:runId catch-all.
  app.route("/api/archives/search", deps.archivesSearchRouter);
  app.route("/api/archives", deps.publicArchivesRouter);

  // Public home composite + must-read listing.
  app.route("/api/home", deps.publicHomeRouter);
  app.route("/api/must-read", deps.publicMustReadRouter);

  // Public sources summary (no admin gate). Must be mounted BEFORE the
  // auth-gated tenant sources router below so /api/sources/summary stays
  // public while source management requires a session.
  app.route("/api/sources", deps.publicSourcesRouter);

  // Public tenant branding (P7) — payload + logo bytes.
  if (deps.brandingRouter) {
    app.route("/api/branding", deps.brandingRouter);
  }

  // LinkedIn OAuth callback — mounted BEFORE adminApp so the gate does not
  // intercept requests to this path. LinkedIn redirects the user's browser here
  // after authorization; no admin_session cookie is present on the redirect.
  // Security is provided by the unguessable Redis-stored CSRF state (consume-once).
  app.route(
    "/api/admin/social-credentials/linkedin/oauth/callback",
    deps.linkedInOAuthCallbackRouter,
  );

  // Twitter OAuth2 callback — same gate exemption as the LinkedIn callback
  // above (P13, REQ-081): state-gated, not cookie-gated.
  if (deps.twitterOAuthCallbackRouter) {
    app.route(
      "/api/admin/social-credentials/twitter/oauth/callback",
      deps.twitterOAuthCallbackRouter,
    );
  }

  // Per-user auth routes (signup/login/logout/forgot/reset/me) — ungated;
  // they establish the session the gate below verifies.
  app.route("/api/auth", deps.authRouter);

  // Chrome extension API — ungated like /api/auth; the router applies its own
  // `ext|` bearer auth (requireExtensionAuth) and `chrome-extension://` CORS.
  if (deps.extensionRouter) {
    app.route("/api/extension", deps.extensionRouter);
  }

  // Everything under /api/admin requires a valid session cookie.
  const gate = deps.requireAuthFactory(deps.sessionSecret);

  const adminApp = new Hono();
  adminApp.use("*", gate);
  // Feature-flag enforcement (Fix #4) — gate the admin Eval and Deliverability
  // (analytics) surfaces. The web app shows an in-app "enable in Settings"
  // notice for these; this 403 is defense in depth against direct API calls.
  // The Sources analytics tab reads /api/sources/summary, so it is untouched.
  if (deps.requireFeature) {
    adminApp.use("/eval/*", deps.requireFeature("featureEval"));
    adminApp.use("/analytics/*", deps.requireFeature("featureDeliverability"));
  }
  adminApp.route("/archives", deps.adminArchivesRouter);
  adminApp.route("/runs", deps.adminRunsRouter);
  adminApp.route("/eval", deps.adminEvalRouter);
  adminApp.route("/social-credentials", deps.adminSocialCredentialsRouter);
  // Admin-gated LinkedIn OAuth start + status routes.
  adminApp.route(
    "/social-credentials/linkedin/oauth",
    deps.linkedInOAuthRouter,
  );
  // Admin-gated Twitter OAuth2 start + status routes (P13, REQ-081).
  if (deps.twitterOAuthRouter) {
    adminApp.route(
      "/social-credentials/twitter/oauth",
      deps.twitterOAuthRouter,
    );
  }
  adminApp.route("/must-read", deps.adminMustReadRouter);
  adminApp.route("/analytics", deps.analyticsRouter);
  adminApp.route("/collector-health", deps.collectorHealthRouter);
  if (deps.webDomainRouter) {
    adminApp.route("/web-domain", deps.webDomainRouter);
  }
  app.route("/api/admin", adminApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));

  // Sending-domain panel (P14) — its own sub-app: the settings router's
  // GET "/" / PUT "/" never match /domain paths, but mounting separately
  // keeps the dependency graphs of the two routers independent.
  if (deps.sendingDomainRouter) {
    app.route("/api/settings/domain", gatedWrap(gate, deps.sendingDomainRouter));
  }
  // Notification settings + feature flags (P16, REQ-092/093) — handles the
  // /notifications and /features sub-paths; the legacy settings router's
  // GET "/" / PUT "/" never match those.
  if (deps.notificationSettingsRouter) {
    app.route("/api/settings", gatedWrap(gate, deps.notificationSettingsRouter));
  }
  // Admin branding (FIX #1) matches /branding + /branding/logo only; the legacy
  // settings router's GET "/" / PUT "/" never match those sub-paths.
  if (deps.brandingSettingsRouter) {
    app.route("/api/settings", gatedWrap(gate, deps.brandingSettingsRouter));
  }
  if (deps.emailSettingsRouter) {
    app.route("/api/settings", gatedWrap(gate, deps.emailSettingsRouter));
  }
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));

  // Tenant source management (P8) — auth-gated; requests that the public
  // summary router above already handled (GET /summary) never reach this.
  if (deps.tenantSourcesRouter) {
    app.route("/api/sources", gatedWrap(gate, deps.tenantSourcesRouter));
  }

  // Onboarding wizard (P11) — auth-gated tenant_admin surface.
  if (deps.onboardingRouter) {
    app.route("/api/onboarding", gatedWrap(gate, deps.onboardingRouter));
  }

  // Super-admin app-level credentials (P12, REQ-082/086) — self-gated via
  // requireSuperAdmin inside the router. Mounted BEFORE the console router so
  // its paths never fall through to the console's catch-alls.
  if (deps.superAppCredentialsRouter) {
    app.route("/api/super/app-credentials", deps.superAppCredentialsRouter);
  }

  // Super-admin console (self-gated via requireSuperAdmin inside the router).
  if (deps.superAdminRouter) {
    app.route("/api/super", deps.superAdminRouter);
  }

  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    if (status >= 500) {
      void captureException(err, { method: c.req.method, path: c.req.path }); // fire-and-forget
    }
    if (err instanceof HTTPException) return err.getResponse();
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}

function gatedWrap(mw: MiddlewareHandler, router: Hono): Hono {
  const app = new Hono();
  app.use("*", mw);
  app.route("/", router);
  return app;
}

/** Node socket peer address, if the adapter exposes it (undefined otherwise). */
function peerRemoteAddress(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  const incoming = (env as { incoming?: unknown }).incoming;
  if (typeof incoming !== "object" || incoming === null) return undefined;
  const socket = (incoming as { socket?: unknown }).socket;
  if (typeof socket !== "object" || socket === null) return undefined;
  const addr = (socket as { remoteAddress?: unknown }).remoteAddress;
  return typeof addr === "string" ? addr : undefined;
}

/**
 * True when the request's peer is loopback — or when the peer can't be
 * determined (unit tests / non-node adapters), so it never blocks those.
 * Production (node-server behind Caddy) always sees 127.0.0.1.
 */
function isLoopbackPeer(c: Context): boolean {
  const addr = peerRemoteAddress(c.env);
  if (addr === undefined) return true;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

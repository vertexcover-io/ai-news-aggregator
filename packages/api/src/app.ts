import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { captureException } from "@api/lib/posthog.js";
import { requireAuth, requireSuperAdmin, requireImpersonation } from "@api/auth/middleware.js";

export interface BuildAppDeps {
  sessionSecret: string;
  /** Host→tenant resolution middleware (Phase 5). Mounted first. */
  resolveTenant: MiddlewareHandler;
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
  /** Admin-gated sending-domain registration + verification routes. */
  sendingDomainRouter: Hono;
  /**
   * Exposes POST /login, POST /logout, GET /me. Mounted under /api/admin with
   * a path-aware gate: /login and /logout bypass the gate; everything else
   * goes through requireAdmin.
   */
  adminRouter: Hono;
  requireAdminFactory: (secret: string) => MiddlewareHandler;
  subscribeRouter: Hono;
  webhooksRouter: Hono;
  analyticsRouter: Hono;
  analyticsConfigRouter: Hono;
  /**
   * Admin-gated LinkedIn OAuth routes (POST /start, GET /status).
   * Mounted inside adminApp — behind requireAdmin.
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
   * Admin-gated Twitter OAuth2 routes (POST /start, GET /status).
   * Mounted inside adminApp — behind requireAdmin.
   */
  twitterOAuthRouter: Hono;
  /**
   * Public (ungated) Twitter OAuth2 callback router (GET /).
   * Twitter redirects the browser here after authorization; no admin cookie
   * is present on the redirect. Security is the Redis-stored CSRF state +
   * PKCE codeVerifier (consume-once).
   * Mounted BEFORE adminApp so the gate does not intercept this path.
   */
  twitterOAuthCallbackRouter: Hono;
  /** Admin-gated collector health check trigger + snapshot routes. */
  collectorHealthRouter: Hono;
  /** Admin-gated onboarding wizard routes (GET/PATCH /, POST /activate, etc.). */
  onboardingRouter: Hono;
  /** Admin-gated sources CRUD routes. Mounted under /api/admin/sources. */
  sourcesAdminRouter: Hono;
  /** Admin-gated per-tenant notification settings routes. Mounted under /api/settings/notifications. */
  notificationsRouter: Hono;
  /** Admin-gated per-tenant feature flag routes. Mounted under /api/settings/features. */
  featuresRouter: Hono;
  /** Super-admin-only app-level credential routes. Mounted under /api/super/app-credentials. */
  superAppCredentialsRouter: Hono;
  /** Super-admin tenant list + impersonation routes. Mounted under /api/super (REQ-100, REQ-101, REQ-102). */
  superAdminRouter: Hono;
  /** Public logo route — serves tenant logo bytes with caching headers. */
  publicLogoRouter?: Hono;
  /** Public auth routes (Phase 3): signup, login, logout, forgot/reset, me. Mounted at /api/auth. */
  authRouter?: Hono;
}

const ADMIN_PUBLIC_SUFFIXES = new Set(["/login", "/logout"]);

/**
 * Compose the full API Hono app.
 *
 * Route table (authoritative — see also index.ts):
 *
 *   Public:
 *     GET  /api/archives
 *     GET  /api/archives/:runId
 *     POST /api/admin/login
 *     POST /api/admin/logout
 *
 *   Admin-gated (requireAdmin):
 *     GET  /api/admin/me
 *     *    /api/admin/archives/*
 *     *    /api/runs/*
 *     *    /api/settings
 */
export function buildApp(deps: BuildAppDeps): Hono {
  const app = new Hono();

  // Host→tenant resolution middleware — must run before all routes.
  // Classifies request by Host header (or X-Tenant-Slug dev override):
  // app-host (passthrough), slug-host, custom-domain, old-slug (301), unknown (404).
  // Populates c.var.tenantCtx for public routes; admin routes get tenant
  // from session via requireAuth/requireAdmin.
  app.use("*", deps.resolveTenant);

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public auth routes (Phase 3): signup, login, logout, forgot-password, reset-password, me.
  // Mounted at /api/auth — no auth gate (each route handles its own rate limiting).
  if (deps.authRouter) {
    app.route("/api/auth", deps.authRouter);
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

  // Public sources summary (no admin gate).
  app.route("/api/sources", deps.publicSourcesRouter);

  // Public tenant logo endpoint — serves binary with Content-Type + Cache-Control.
  if (deps.publicLogoRouter) {
    app.route("/api/logo", deps.publicLogoRouter);
  }

  // LinkedIn OAuth callback — mounted BEFORE adminApp so the gate does not
  // intercept requests to this path. LinkedIn redirects the user's browser here
  // after authorization; no admin_session cookie is present on the redirect.
  // Security is provided by the unguessable Redis-stored CSRF state (consume-once).
  app.route(
    "/api/admin/social-credentials/linkedin/oauth/callback",
    deps.linkedInOAuthCallbackRouter,
  );

  // Twitter OAuth2 callback — same pattern as LinkedIn: mounted BEFORE adminApp.
  // Twitter redirects the user's browser here after authorization; no admin_session
  // cookie is present. Security is the Redis-stored CSRF state + PKCE codeVerifier.
  app.route(
    "/api/admin/social-credentials/twitter/oauth/callback",
    deps.twitterOAuthCallbackRouter,
  );

  // Path-aware admin gate: login/logout skip, everything else requires a
  // valid admin_session cookie.
  const gate = deps.requireAdminFactory(deps.sessionSecret);
  const conditionalGate: MiddlewareHandler = async (c, next) => {
    const suffix = new URL(c.req.url).pathname.replace(/^\/api\/admin/, "");
    if (ADMIN_PUBLIC_SUFFIXES.has(suffix || "/")) {
      await next();
      return;
    }
    return gate(c, next);
  };

  const adminApp = new Hono();
  adminApp.use("*", conditionalGate);
  adminApp.route("/", deps.adminRouter);
  adminApp.route("/archives", deps.adminArchivesRouter);
  adminApp.route("/runs", deps.adminRunsRouter);
  adminApp.route("/eval", deps.adminEvalRouter);
  adminApp.route("/social-credentials", deps.adminSocialCredentialsRouter);
  // Admin-gated LinkedIn OAuth start + status routes.
  adminApp.route(
    "/social-credentials/linkedin/oauth",
    deps.linkedInOAuthRouter,
  );
  // Admin-gated Twitter OAuth2 start + status routes.
  adminApp.route(
    "/social-credentials/twitter/oauth",
    deps.twitterOAuthRouter,
  );
  adminApp.route("/must-read", deps.adminMustReadRouter);
  adminApp.route("/analytics", deps.analyticsRouter);
  adminApp.route("/collector-health", deps.collectorHealthRouter);
  adminApp.route("/sources", deps.sourcesAdminRouter);
  app.route("/api/admin", adminApp);

  // Onboarding wizard — /slug-available is public (used during signup flow,
  // no auth required); all other onboarding routes require a session with
  // tenantCtx. The onboarding router's own middleware handles the auth skip
  // for /slug-available by checking c.req.path. We wrap the whole thing in a
  // conditional gate that only applies requireAuth for non-slug-available paths.
  const onboardingConditionalGate: MiddlewareHandler = async (c, next) => {
    if (c.req.path === "/api/onboarding/slug-available") {
      await next();
      return;
    }
    return requireAuth(deps.sessionSecret)(c, next);
  };
  const onboardingApp = new Hono();
  onboardingApp.use("*", onboardingConditionalGate);
  onboardingApp.route("/", deps.onboardingRouter);
  app.route("/api/onboarding", onboardingApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.sendingDomainRouter));
  app.route("/api/settings/notifications", gatedWrap(gate, deps.notificationsRouter));
  app.route("/api/settings/features", gatedWrap(gate, deps.featuresRouter));

  // Super-admin-only routes: require auth + super_admin role
  // impersonation middleware runs first in the chain: if an impersonation
  // cookie is present, it swaps tenantCtx BEFORE requireSuperAdmin checks
  // role — so impersonated requests are naturally blocked from super routes
  // (EDGE-008: no privilege elevation).
  const superApp = new Hono();
  superApp.use("*", requireImpersonation(deps.sessionSecret));
  superApp.use("*", requireAuth(deps.sessionSecret));
  superApp.use("*", requireSuperAdmin());
  superApp.route("/app-credentials", deps.superAppCredentialsRouter);
  superApp.route("/", deps.superAdminRouter);
  app.route("/api/super", superApp);

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

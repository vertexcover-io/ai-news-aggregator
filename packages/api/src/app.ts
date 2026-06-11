import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { captureException } from "@api/lib/posthog.js";

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
   * Tenant source management (P8, REQ-070/072/074): GET/POST /api/sources +
   * PATCH/DELETE /api/sources/:id, auth-gated. Mounted on /api/sources AFTER
   * the public summary router, so GET /api/sources/summary stays public and
   * everything else on the path requires a session. Optional ONLY so existing
   * unit tests composing buildApp keep working — index.ts always provides it.
   */
  tenantSourcesRouter?: Hono;
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

  // Host→tenant resolution runs before every /api route (P5): public routes
  // use the Host-derived tenant, admin routes keep the session tenant set by
  // requireAuth below (REQ-020/021/022).
  if (deps.resolveTenant) {
    app.use("/api/*", deps.resolveTenant);
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

  // Per-user auth routes (signup/login/logout/forgot/reset/me) — ungated;
  // they establish the session the gate below verifies.
  app.route("/api/auth", deps.authRouter);

  // Everything under /api/admin requires a valid session cookie.
  const gate = deps.requireAuthFactory(deps.sessionSecret);

  const adminApp = new Hono();
  adminApp.use("*", gate);
  adminApp.route("/archives", deps.adminArchivesRouter);
  adminApp.route("/runs", deps.adminRunsRouter);
  adminApp.route("/eval", deps.adminEvalRouter);
  adminApp.route("/social-credentials", deps.adminSocialCredentialsRouter);
  // Admin-gated LinkedIn OAuth start + status routes.
  adminApp.route(
    "/social-credentials/linkedin/oauth",
    deps.linkedInOAuthRouter,
  );
  adminApp.route("/must-read", deps.adminMustReadRouter);
  adminApp.route("/analytics", deps.analyticsRouter);
  adminApp.route("/collector-health", deps.collectorHealthRouter);
  app.route("/api/admin", adminApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));

  // Tenant source management (P8) — auth-gated; requests that the public
  // summary router above already handled (GET /summary) never reach this.
  if (deps.tenantSourcesRouter) {
    app.route("/api/sources", gatedWrap(gate, deps.tenantSourcesRouter));
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

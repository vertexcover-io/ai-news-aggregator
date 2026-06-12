import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { captureException } from "@api/lib/posthog.js";

export interface BuildAppDeps {
  sessionSecret: string;
  /**
   * Host-resolution middleware mounted in front of every public router (and
   * the public POST /api/subscribe path). Sets `publicTenant` on the context;
   * unknown hosts get a 404 before the router runs. Admin routers do NOT get
   * it — their tenant comes from the session via requireUser.
   */
  publicTenantMiddleware: MiddlewareHandler;
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
  /** Tenant source CRUD + discovery (/api/admin/sources, REQ-070..073). */
  adminSourcesRouter: Hono;
  runsRouter: Hono;
  settingsRouter: Hono;
  /**
   * Exposes POST /signup, /login, /logout, /forgot-password, /reset-password
   * and GET /me. Mounted ungated under /api/auth — /me gates itself with
   * requireUser; the rest are public by design.
   */
  authRouter: Hono;
  /** Factory for the session gate applied to all /api/admin, /api/runs, and
   * /api/settings routes. Any authenticated user passes for now — tenant
   * scoping arrives in Phase 3, super-admin-only splits in later phases. */
  requireUserFactory: (secret: string) => MiddlewareHandler;
  subscribeRouter: Hono;
  webhooksRouter: Hono;
  analyticsRouter: Hono;
  analyticsConfigRouter: Hono;
  /**
   * Admin-gated LinkedIn OAuth routes (POST /start, GET /status).
   * Mounted inside adminApp — behind the session gate.
   */
  linkedInOAuthRouter: Hono;
  /**
   * Public (ungated) LinkedIn OAuth callback router (GET /).
   * LinkedIn redirects the browser here after authorization; no session
   * cookie is present on the redirect. Security is the Redis-stored CSRF
   * state token. Mounted BEFORE adminApp so the gate does not intercept it.
   */
  linkedInOAuthCallbackRouter: Hono;
  /** Admin-gated collector health check trigger + snapshot routes. */
  collectorHealthRouter: Hono;
  /** Tenant sending-domain register/verify/status (REQ-084/085). */
  sendingDomainRouter: Hono;
  /**
   * Admin-gated Twitter OAuth2 routes (POST /start, GET /status, DELETE /).
   * Mounted inside adminApp — behind the session gate.
   */
  twitterOAuthRouter: Hono;
  /**
   * Public (ungated) Twitter OAuth2 callback router (GET /). Same security
   * model as the LinkedIn callback: consume-once Redis CSRF state, mounted
   * BEFORE adminApp so the gate does not intercept it.
   */
  twitterOAuthCallbackRouter: Hono;
  /** Public host-resolved tenant branding config (REQ-040/042/122). */
  publicTenantConfigRouter: Hono;
  /** Public host-resolved tenant logo bytes (REQ-043). */
  publicTenantLogoRouter: Hono;
  /** Admin-gated branding mutations: PUT / and PUT /logo (REQ-039). */
  adminBrandingRouter: Hono;
  /**
   * Onboarding wizard state/slug-check/generate-prompts/activate
   * (REQ-030..038). Mounted inside adminApp at /api/admin/onboarding —
   * behind requireUser. Optional only for legacy test fixtures; index.ts
   * always provides it.
   */
  onboardingRouter?: Hono;
  /**
   * Super-admin tenant list + impersonation start/exit (REQ-100..103).
   * The router self-gates with requireSuperAdmin, so it is mounted outside
   * the plain requireUser adminApp gate. Optional only for legacy test
   * fixtures; index.ts always provides it.
   */
  superAdminRouter?: Hono;
}

/**
 * Compose the full API Hono app.
 *
 * Route table (authoritative — see also index.ts):
 *
 *   Public:
 *     GET  /api/archives
 *     GET  /api/archives/:runId
 *     POST /api/auth/signup | /login | /logout | /forgot-password | /reset-password
 *
 *   Session-gated (requireUser):
 *     GET  /api/auth/me
 *     *    /api/admin/*
 *     *    /api/runs/*
 *     *    /api/settings
 */
export function buildApp(deps: BuildAppDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  const publicTenant = deps.publicTenantMiddleware;
  const mountPublic = (path: string, router: Hono): void => {
    app.use(path, publicTenant);
    app.use(`${path}/*`, publicTenant);
    app.route(path, router);
  };

  // Public subscribe/confirm/unsubscribe routes. Only POST /subscribe is
  // host-scoped (the new subscriber belongs to the host's tenant); confirm,
  // unsubscribe, and feedback resolve their tenant from the signed subscriber
  // token instead, so email links keep working on any host.
  app.use("/api/subscribe", publicTenant);
  app.route("/api", deps.subscribeRouter);

  // Public SNS/SES webhook — no auth, no Host scoping: the tenant is resolved
  // from the email_send row referenced by the SES messageId.
  app.route("/api/webhooks", deps.webhooksRouter);

  // Public runtime analytics configuration for the browser SDK.
  mountPublic("/api/public/analytics-config", deps.analyticsConfigRouter);

  // Public archives. /search MUST be mounted before the public router so
  // it does not collide with the GET /:runId catch-all.
  mountPublic("/api/archives/search", deps.archivesSearchRouter);
  mountPublic("/api/archives", deps.publicArchivesRouter);

  // Public home composite + must-read listing.
  mountPublic("/api/home", deps.publicHomeRouter);
  mountPublic("/api/must-read", deps.publicMustReadRouter);

  // Public sources summary (no admin gate).
  mountPublic("/api/sources", deps.publicSourcesRouter);

  // Public host-resolved tenant branding config + logo bytes.
  mountPublic("/api/public/tenant-config", deps.publicTenantConfigRouter);
  mountPublic("/api/public/tenant-logo", deps.publicTenantLogoRouter);

  // Auth routes — public except GET /me which self-gates.
  app.route("/api/auth", deps.authRouter);

  // LinkedIn OAuth callback — mounted BEFORE adminApp so the gate does not
  // intercept requests to this path. LinkedIn redirects the user's browser here
  // after authorization; no session cookie is present on the redirect.
  // Security is provided by the unguessable Redis-stored CSRF state (consume-once).
  app.route(
    "/api/admin/social-credentials/linkedin/oauth/callback",
    deps.linkedInOAuthCallbackRouter,
  );
  // Twitter OAuth2 callback — same ungated mounting rationale as LinkedIn.
  app.route(
    "/api/admin/social-credentials/twitter/oauth/callback",
    deps.twitterOAuthCallbackRouter,
  );

  // Super-admin surface — self-gated with requireSuperAdmin (stricter than
  // the requireUser gate below), so it is mounted directly.
  if (deps.superAdminRouter) {
    app.route("/api/super-admin", deps.superAdminRouter);
  }

  const gate = deps.requireUserFactory(deps.sessionSecret);

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
  // Admin-gated Twitter OAuth2 start + status + disconnect routes.
  adminApp.route(
    "/social-credentials/twitter/oauth",
    deps.twitterOAuthRouter,
  );
  adminApp.route("/sending-domain", deps.sendingDomainRouter);
  adminApp.route("/branding", deps.adminBrandingRouter);
  adminApp.route("/must-read", deps.adminMustReadRouter);
  adminApp.route("/sources", deps.adminSourcesRouter);
  adminApp.route("/analytics", deps.analyticsRouter);
  adminApp.route("/collector-health", deps.collectorHealthRouter);
  if (deps.onboardingRouter) {
    adminApp.route("/onboarding", deps.onboardingRouter);
  }
  app.route("/api/admin", adminApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));

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

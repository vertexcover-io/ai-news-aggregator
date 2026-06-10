import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { captureException } from "@api/lib/posthog.js";
import type { TenantVariables } from "@api/middleware/types.js";
import { hostTenant } from "@api/middleware/host-tenant.js";

export interface AppEnv {
  Variables: TenantVariables;
}

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
  runsRouter: Hono<AppEnv>;
  settingsRouter: Hono<AppEnv>;
  /** PUBLIC tenant-account auth: signup/login/logout/forgot/reset. */
  authRouter: Hono;
  /** Per-IP rate-limit middleware applied to the auth router's write routes. */
  authRateLimit: MiddlewareHandler;
  /** PUBLIC per-tenant branding + logo (host/slug resolved). */
  tenantPublicRouter: Hono<AppEnv>;
  /** GATED tenant onboarding wizard. */
  onboardingRouter: Hono<AppEnv>;
  /** GATED per-tenant source management + discovery. */
  tenantSourcesRouter: Hono<AppEnv>;
  /** GATED per-tenant settings (branding, flags, notifications, slack). */
  tenantSettingsRouter: Hono<AppEnv>;
  /** GATED per-tenant sending-domain registration + verification. */
  sendingDomainsRouter: Hono<AppEnv>;
  /** GATED super-admin tenant overview + impersonation (self-gates to super_admin). */
  superAdminRouter: Hono<AppEnv>;
  /** GATED super-admin app-level credentials (self-gates to super_admin). */
  superAdminCredentialsRouter: Hono<AppEnv>;
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
  /** Admin-gated collector health check trigger + snapshot routes. */
  collectorHealthRouter: Hono;
  /**
   * Optional resolver for the host-tenant middleware. Maps a tenant slug
   * (`<slug>.<ROOT_DOMAIN>`) to a tenant id. Phase 1 ships no tenants repo, so
   * this is omitted and the middleware merely stashes the slug; every request
   * still resolves to AGENTLOOP via the admin gate / repo defaults.
   */
  resolveTenantBySlug?: (slug: string) => Promise<{ tenantId: string } | null>;
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
export function buildApp(deps: BuildAppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Resolve the host tenant before any route runs. On admin/app hosts this is a
  // no-op; tenant identity for admin routes is set by requireAdmin downstream.
  app.use("*", hostTenant({ resolveTenantBySlug: deps.resolveTenantBySlug }));

  app.get("/health", (c) => c.json({ status: "ok" }));

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

  // PUBLIC tenant-account auth. Per-IP rate-limit guards the write routes
  // (signup/login/forgot/reset) before the router runs (NF2).
  const authApp = new Hono<AppEnv>();
  authApp.use("/signup", deps.authRateLimit);
  authApp.use("/login", deps.authRateLimit);
  authApp.use("/forgot", deps.authRateLimit);
  authApp.use("/reset", deps.authRateLimit);
  authApp.route("/", deps.authRouter);
  app.route("/api/auth", authApp);

  // PUBLIC per-tenant branding + logo (tenant resolved by host/slug upstream).
  app.route("/api/tenant", deps.tenantPublicRouter);

  // LinkedIn OAuth callback — mounted BEFORE adminApp so the gate does not
  // intercept requests to this path. LinkedIn redirects the user's browser here
  // after authorization; no admin_session cookie is present on the redirect.
  // Security is provided by the unguessable Redis-stored CSRF state (consume-once).
  app.route(
    "/api/admin/social-credentials/linkedin/oauth/callback",
    deps.linkedInOAuthCallbackRouter,
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

  const adminApp = new Hono<AppEnv>();
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
  adminApp.route("/must-read", deps.adminMustReadRouter);
  adminApp.route("/analytics", deps.analyticsRouter);
  adminApp.route("/collector-health", deps.collectorHealthRouter);
  app.route("/api/admin", adminApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));

  // GATED multi-tenancy product surfaces. All sit behind requireAdmin so the
  // tenant session cookie resolves `tenantCtx` before the handler runs; the
  // super-admin routers additionally self-gate to role === "super_admin".
  app.route("/api/onboarding", gatedWrap(gate, deps.onboardingRouter));
  app.route("/api/tenant-sources", gatedWrap(gate, deps.tenantSourcesRouter));
  app.route("/api/tenant-settings", gatedWrap(gate, deps.tenantSettingsRouter));
  app.route("/api/sending-domains", gatedWrap(gate, deps.sendingDomainsRouter));
  // Mount the more-specific credentials prefix before the tenant overview so it
  // is not shadowed by the /api/super-admin router.
  app.route(
    "/api/super-admin/credentials",
    gatedWrap(gate, deps.superAdminCredentialsRouter),
  );
  app.route("/api/super-admin", gatedWrap(gate, deps.superAdminRouter));

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

function gatedWrap(mw: MiddlewareHandler, router: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", mw);
  app.route("/", router);
  return app;
}

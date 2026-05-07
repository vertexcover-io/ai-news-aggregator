import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

export interface BuildAppDeps {
  sessionSecret: string;
  publicArchivesRouter: Hono;
  adminArchivesRouter: Hono;
  runsRouter: Hono;
  settingsRouter: Hono;
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
  /**
   * Mounted at /archive/:runId. Returns server-rendered HTML with Open Graph
   * meta tags pulled from the archive row, so social-media scrapers (LinkedIn,
   * Slack, Facebook) that don't execute JavaScript can render preview cards.
   * Caddy routes bot user-agents to this path; real browsers continue to hit
   * the static SPA.
   */
  ogArchiveRouter: Hono;
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

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public subscribe/confirm/unsubscribe routes.
  app.route("/api", deps.subscribeRouter);

  // Public SNS/SES webhook — no auth required.
  app.route("/api/webhooks", deps.webhooksRouter);

  // Public archives.
  app.route("/api/archives", deps.publicArchivesRouter);

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
  adminApp.route("/analytics", deps.analyticsRouter);
  app.route("/api/admin", adminApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));

  // Public OG-tagged HTML for /archive/:runId — served to social bots only
  // (Caddy gates this by user-agent in production).
  app.route("/archive", deps.ogArchiveRouter);

  return app;
}

function gatedWrap(mw: MiddlewareHandler, router: Hono): Hono {
  const app = new Hono();
  app.use("*", mw);
  app.route("/", router);
  return app;
}

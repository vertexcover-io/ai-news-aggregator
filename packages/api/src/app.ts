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
  app.route("/api/admin", adminApp);

  app.route("/api/runs", gatedWrap(gate, deps.runsRouter));
  app.route("/api/settings", gatedWrap(gate, deps.settingsRouter));

  return app;
}

function gatedWrap(mw: MiddlewareHandler, router: Hono): Hono {
  const app = new Hono();
  app.use("*", mw);
  app.route("/", router);
  return app;
}

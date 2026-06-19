/**
 * Chrome extension API (multi-tenant). Two routes, mounted at /api/extension
 * OUTSIDE the admin cookie gate — auth is a separate `ext|`-namespaced bearer
 * token, and CORS is scoped to `chrome-extension://` origins only.
 *
 *   POST /login        → { token, expiresAt, user } | 401 | 403 select_tenant
 *   POST /submissions  → 201 SubmissionResult  (requireExtensionAuth)
 *
 * Seamless multi-tenancy: the bearer token embeds {userId, tenantId, role};
 * `requireExtensionAuth` lifts it onto `tenantCtx`, so the submission's repo is
 * tenant-scoped identically to the cookie path — the manual row is stamped with
 * the submitter's tenant and competes in THAT tenant's next run (REQ-020).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb as defaultGetDb } from "@newsletter/shared";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import {
  createRawItemsRepo as createPipelineRawItemsRepo,
  canonicalizeUrl,
} from "@newsletter/pipeline/add-post";
import { createUsersRepo, type UsersRepo } from "@api/repositories/users.js";
import { login } from "@api/services/auth.js";
import { issueExtensionToken, EXT_MAX_AGE_MS } from "@api/auth/extension-token.js";
import { requireExtensionAuth } from "@api/auth/extension-middleware.js";
import { extensionLoginSchema, submitUrlSchema } from "@api/lib/validate.js";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";
import {
  createUserSubmission,
  type EnrichUrlFn,
  type SubmissionRawItemsRepo,
} from "@api/services/user-submissions.js";

export interface ExtensionRouterDeps {
  sessionSecret: string;
  getUsersRepo: () => Pick<UsersRepo, "findByEmail">;
  getRawItemsRepo: (scope?: TenantScope) => SubmissionRawItemsRepo;
  canonicalizeUrl: (url: string) => string;
  /** Optional server-side enrichment; defaults to a no-op (title comes from the page). */
  enrichUrl?: EnrichUrlFn;
}

/** CORS gate for the extension API — only `chrome-extension://` origins. */
export function createExtensionCorsMiddleware(): ReturnType<typeof cors> {
  return cors({
    origin: (origin) => (origin.startsWith("chrome-extension://") ? origin : ""),
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  });
}

export function createExtensionRouter(deps: ExtensionRouterDeps): Hono {
  const app = new Hono();
  app.use("*", createExtensionCorsMiddleware());

  app.post("/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = extensionLoginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const user = await login({ usersRepo: deps.getUsersRepo() }, parsed.data);
    if (user === null) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    // v1: tenant_admins only. A super_admin (tenantId === null) has no implicit
    // tenant; they pick one in the web app (impersonation). Decline cleanly so
    // the popup can show a "use the web app" message rather than mis-filing the
    // submission under no tenant.
    if (user.tenantId === null) {
      return c.json(
        {
          error: "select_tenant",
          message:
            "Super-admins must choose a tenant in the web app before using the extension.",
        },
        403,
      );
    }

    const token = issueExtensionToken(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      deps.sessionSecret,
    );
    return c.json(
      {
        token,
        expiresAt: Date.now() + EXT_MAX_AGE_MS,
        user: { role: user.role, tenantId: user.tenantId },
      },
      200,
    );
  });

  app.use("/submissions", requireExtensionAuth(deps.sessionSecret));
  app.post("/submissions", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = submitUrlSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    // Tenant comes from the verified bearer token (set on tenantCtx by
    // requireExtensionAuth) — never from the Host (REQ-020).
    const scope = tenantScopeFromContext(c);
    const rawItemsRepo = deps.getRawItemsRepo(scope);
    const enrichUrl: EnrichUrlFn =
      deps.enrichUrl ?? (() => Promise.resolve({}));

    const result = await createUserSubmission(
      { url: parsed.data.url, title: parsed.data.title },
      { rawItemsRepo, canonicalizeUrl: deps.canonicalizeUrl, enrichUrl },
    );
    return c.json(result, 201);
  });

  return app;
}

export function createDefaultExtensionRouter(): Hono {
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  return createExtensionRouter({
    sessionSecret,
    getUsersRepo: () => createUsersRepo(defaultGetDb()),
    getRawItemsRepo: (scope) => createPipelineRawItemsRepo(defaultGetDb(), scope),
    canonicalizeUrl,
  });
}

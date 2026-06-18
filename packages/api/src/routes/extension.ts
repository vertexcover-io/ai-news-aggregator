import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { verifyPassword } from "@api/auth/session.js";
import { issueExtensionToken, EXT_MAX_AGE_MS } from "@api/auth/extension-token.js";
import { requireExtensionAuth } from "@api/auth/extension-middleware.js";
import { extensionLoginSchema, submitUrlSchema } from "@api/lib/validate.js";
import {
  createUserSubmission,
  createEnrichUrlFromHydrate,
  type CreateSubmissionDeps,
} from "@api/services/user-submissions.js";
import { createRawItemsRepo, type RawItemsRepo } from "@api/repositories/raw-items.js";
import type { HydrateAddedPostFn } from "@api/services/review.js";

export interface ExtensionRouterDeps {
  adminPassword: string;
  sessionSecret: string;
  getRawItemsRepo: () => RawItemsRepo;
  hydrateAddedPost?: HydrateAddedPostFn;
}

export function createExtensionRouter(deps: ExtensionRouterDeps): Hono {
  const app = new Hono();

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

    if (!verifyPassword(parsed.data.password, deps.adminPassword)) {
      return c.json({ error: "invalid_password" }, 401);
    }

    const now = Date.now();
    const token = issueExtensionToken(deps.sessionSecret, now);
    const expiresAt = now + EXT_MAX_AGE_MS;
    return c.json({ token, expiresAt }, 200);
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

    const rawItemsRepo = deps.getRawItemsRepo();
    const hydratePost = deps.hydrateAddedPost;
    const enrichFn = hydratePost
      ? createEnrichUrlFromHydrate(
          (url, _sourceType, options) => hydratePost(url, _sourceType, options),
        )
      : () => Promise.resolve({});

    const submissionDeps: CreateSubmissionDeps = {
      rawItemsRepo,
      enrichUrl: enrichFn,
    };

    const result = await createUserSubmission(
      { url: parsed.data.url, title: parsed.data.title },
      submissionDeps,
    );

    return c.json(result, 201);
  });

  return app;
}

export function createExtensionCorsMiddleware(): ReturnType<typeof cors> {
  return cors({
    origin: (origin) =>
      origin.startsWith("chrome-extension://") ? origin : "",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  });
}

function createDefaultHydrateAddedPost(): HydrateAddedPostFn {
  return async (url, sourceType, options) => {
    const { hydrateAddedPost } = await import("@newsletter/pipeline/add-post");
    const { createRawItemsRepo: createPipelineRawItemsRepo } = await import(
      "@newsletter/pipeline/add-post"
    );
    return hydrateAddedPost(url, sourceType, {
      rawItemsRepo: createPipelineRawItemsRepo(defaultGetDb()),
      signal: options?.signal,
    });
  };
}

export function createDefaultExtensionRouter(): Hono {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  return createExtensionRouter({
    adminPassword,
    sessionSecret,
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    hydrateAddedPost: createDefaultHydrateAddedPost(),
  });
}

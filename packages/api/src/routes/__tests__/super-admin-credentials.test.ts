import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createSuperAdminCredentialsRouter } from "../super-admin-credentials.js";
import type { TenantVariables } from "../../middleware/types.js";
import type { TenantContext, Role } from "@newsletter/shared/tenant";
import type {
  SocialCredentialsRepo,
  SocialCredentialsStatus,
  SocialCredentialPlatform,
  LinkedInUpsertInput,
  TwitterCollectorUpsertInput,
} from "../../repositories/social-credentials.js";

function makeRepo(): {
  repo: SocialCredentialsRepo;
  has: (p: SocialCredentialPlatform) => boolean;
} {
  const stored = new Set<SocialCredentialPlatform>();
  const repo: SocialCredentialsRepo = {
    getLinkedIn: () => Promise.resolve(null),
    getStatus: (): Promise<SocialCredentialsStatus> =>
      Promise.resolve({
        linkedin: {
          configured: stored.has("linkedin"),
          apiVersion: null,
          updatedAt: stored.has("linkedin") ? new Date().toISOString() : null,
        },
        twitter: { configured: false, updatedAt: null },
        twitterCollector: {
          configured: stored.has("twitter_collector"),
          updatedAt: stored.has("twitter_collector")
            ? new Date().toISOString()
            : null,
        },
      }),
    upsertLinkedIn: (_input: LinkedInUpsertInput) => {
      stored.add("linkedin");
      return Promise.resolve({ updatedAt: new Date().toISOString() });
    },
    upsertTwitter: () =>
      Promise.resolve({ updatedAt: new Date().toISOString() }),
    upsertTwitterCollector: (_input: TwitterCollectorUpsertInput) => {
      stored.add("twitter_collector");
      return Promise.resolve({ updatedAt: new Date().toISOString() });
    },
    delete: (platform: SocialCredentialPlatform) =>
      Promise.resolve(stored.delete(platform)),
  };
  return { repo, has: (p) => stored.has(p) };
}

function ctxWithRole(role: Role): TenantContext {
  return {
    tenantId: "00000000-0000-0000-0000-000000000000",
    userId: "u1",
    role,
  };
}

function buildApp(
  repo: SocialCredentialsRepo,
  ctx: TenantContext | undefined,
): Hono<{ Variables: TenantVariables }> {
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    if (ctx) c.set("tenantCtx", ctx);
    await next();
  });
  app.route("/", createSuperAdminCredentialsRouter({ getRepo: () => repo }));
  return app;
}

describe("super-admin-credentials router — role gating (F62/NF6)", () => {
  it.each<{ name: string; method: string; path: string; body?: string }>([
    { name: "GET status", method: "GET", path: "/" },
    {
      name: "PUT linkedin",
      method: "PUT",
      path: "/linkedin",
      body: JSON.stringify({ clientId: "a", clientSecret: "b" }),
    },
    {
      name: "PUT twitter-collector",
      method: "PUT",
      path: "/twitter-collector",
      body: JSON.stringify({ apiKey: "blob" }),
    },
    { name: "DELETE", method: "DELETE", path: "/linkedin" },
  ])("$name as tenant_admin → 403", async ({ method, path, body }) => {
    const { repo } = makeRepo();
    const app = buildApp(repo, ctxWithRole("tenant_admin"));
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body } : {}),
    });
    expect(res.status).toBe(403);
  });

  it("GET as super_admin → 200", async () => {
    const { repo } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});

describe("super-admin-credentials router — app-level secrets", () => {
  it("PUT linkedin persists and never echoes the secret", async () => {
    const { repo, has } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    const res = await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "client-id", clientSecret: "top-secret" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; configured: boolean };
    expect(body).toMatchObject({ ok: true, configured: true });
    expect(JSON.stringify(body)).not.toContain("top-secret");
    expect(has("linkedin")).toBe(true);
  });

  it("PUT twitter-collector persists the cookie blob", async () => {
    const { repo, has } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    const res = await app.request("/twitter-collector", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "cookie-blob" }),
    });
    expect(res.status).toBe(200);
    expect(has("twitter_collector")).toBe(true);
  });

  it("GET response only exposes app-level platforms (no tenant twitter poster)", async () => {
    const { repo } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    const res = await app.request("/");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["linkedin", "twitterCollector"]);
    expect("twitter" in body).toBe(false);
  });

  it("PUT linkedin with empty secret → 400", async () => {
    const { repo } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    const res = await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "id", clientSecret: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE with a tenant-only platform slug (twitter) → 400", async () => {
    const { repo } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    const res = await app.request("/twitter", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("DELETE linkedin → ok", async () => {
    const { repo } = makeRepo();
    const app = buildApp(repo, ctxWithRole("super_admin"));
    await app.request("/linkedin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "id", clientSecret: "s" }),
    });
    const res = await app.request("/linkedin", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: true });
  });
});

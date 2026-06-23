/**
 * Phase 4 — Apify token management via super-admin app-credentials routes.
 *
 * REQ-015: super PUT upserts token; response has {configured:true, updatedAt}; NO token in body.
 * REQ-016 / EDGE-011: unauthenticated → 401; tenant_admin → 403.
 * REQ-017 / REQ-024: GET / status includes apify.{configured, updatedAt}; never the secret.
 * REQ-018: DELETE /apify removes the row; subsequent status configured:false.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";
import { createSuperAppCredentialsRouter } from "@api/routes/super-app-credentials.js";
import type { AppCredentialsRepo, AppCredentialsStatus } from "@api/repositories/app-credentials.js";
import type { AppCredentialKey } from "@newsletter/shared/db";

const SESSION_SECRET = "super-apify-test-secret-32-bytes-minimum-abcdef";

function superCookie(): string {
  return `${COOKIE_NAME}=${issueToken(
    { userId: "00000000-0000-4000-8000-00000000000f", tenantId: null, role: "super_admin" },
    SESSION_SECRET,
  )}`;
}

function tenantCookie(): string {
  return `${COOKIE_NAME}=${issueToken(
    { userId: "00000000-0000-4000-8000-00000000000a", tenantId: "tenant-id-1", role: "tenant_admin" },
    SESSION_SECRET,
  )}`;
}

const FAKE_UPDATED_AT = "2026-06-18T12:00:00.000Z";
const TOKEN_SENTINEL = "apify-secret-token-that-must-never-appear-in-responses";

function makeRepo(overrides: Partial<AppCredentialsRepo> = {}): AppCredentialsRepo {
  return {
    getStatus: vi.fn().mockResolvedValue({
      linkedinClient: { configured: false, apiVersion: null, updatedAt: null },
      twitterCollector: { configured: false, updatedAt: null },
      twitterClient: { configured: false, updatedAt: null },
      apify: { configured: false, updatedAt: null },
    } satisfies AppCredentialsStatus),
    getLinkedInClient: vi.fn().mockResolvedValue(null),
    getTwitterCollector: vi.fn().mockResolvedValue(null),
    getTwitterClient: vi.fn().mockResolvedValue(null),
    getApifyApiToken: vi.fn().mockResolvedValue(null),
    upsertLinkedInClient: vi.fn().mockResolvedValue({ updatedAt: FAKE_UPDATED_AT }),
    upsertTwitterCollector: vi.fn().mockResolvedValue({ updatedAt: FAKE_UPDATED_AT }),
    upsertTwitterClient: vi.fn().mockResolvedValue({ updatedAt: FAKE_UPDATED_AT }),
    upsertApifyApiToken: vi.fn().mockResolvedValue({ updatedAt: FAKE_UPDATED_AT }),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildApp(repo: AppCredentialsRepo): Hono {
  const app = new Hono();
  app.route(
    "/api/super/app-credentials",
    createSuperAppCredentialsRouter({
      sessionSecret: SESSION_SECRET,
      getRepo: () => repo,
    }),
  );
  return app;
}

describe("Phase 4 — super-admin Apify token route", () => {
  describe("test_REQ_015_put_apify_token_upserts — super PUT upserts; no token in response", () => {
    it("returns 200 with configured:true and updatedAt; body contains no token value", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "PUT",
        headers: { cookie: superCookie(), "content-type": "application/json" },
        body: JSON.stringify({ apiToken: TOKEN_SENTINEL }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.configured).toBe(true);
      expect(typeof body.updatedAt).toBe("string");

      // REQ-024: secret must NOT appear anywhere in the response body
      const bodyText = JSON.stringify(body);
      expect(bodyText).not.toContain(TOKEN_SENTINEL);

      // Repo upsert was called with the token
      expect(repo.upsertApifyApiToken).toHaveBeenCalledWith({ apiToken: TOKEN_SENTINEL });
    });

    it("returns 400 when apiToken is missing", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "PUT",
        headers: { cookie: superCookie(), "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      expect(repo.upsertApifyApiToken).not.toHaveBeenCalled();
    });

    it("returns 400 when apiToken is empty string", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "PUT",
        headers: { cookie: superCookie(), "content-type": "application/json" },
        body: JSON.stringify({ apiToken: "" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("test_REQ_016_apify_route_requires_super_admin — 401 unauth; 403 wrong role", () => {
    it("EDGE-011: returns 401 when not authenticated (PUT /apify)", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiToken: TOKEN_SENTINEL }),
      });

      expect(res.status).toBe(401);
    });

    it("EDGE-011: returns 403 when authenticated as tenant_admin (PUT /apify)", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "PUT",
        headers: { cookie: tenantCookie(), "content-type": "application/json" },
        body: JSON.stringify({ apiToken: TOKEN_SENTINEL }),
      });

      expect(res.status).toBe(403);
    });

    it("returns 401 when not authenticated (GET /)", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials");
      expect(res.status).toBe(401);
    });

    it("returns 403 when authenticated as tenant_admin (GET /)", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials", {
        headers: { cookie: tenantCookie() },
      });

      expect(res.status).toBe(403);
    });
  });

  describe("test_REQ_017_status_excludes_secret — GET / includes apify status; test_REQ_024_token_never_serialized", () => {
    it("returns apify configured:false and updatedAt:null when unconfigured", async () => {
      const repo = makeRepo();
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials", {
        headers: { cookie: superCookie() },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as AppCredentialsStatus;
      expect(body.apify).toBeDefined();
      expect(body.apify.configured).toBe(false);
      expect(body.apify.updatedAt).toBeNull();
    });

    it("returns apify configured:true and updatedAt when row exists", async () => {
      const repo = makeRepo({
        getStatus: vi.fn().mockResolvedValue({
          linkedinClient: { configured: false, apiVersion: null, updatedAt: null },
          twitterCollector: { configured: false, updatedAt: null },
          twitterClient: { configured: false, updatedAt: null },
          apify: { configured: true, updatedAt: FAKE_UPDATED_AT },
        } satisfies AppCredentialsStatus),
      });
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials", {
        headers: { cookie: superCookie() },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as AppCredentialsStatus;
      expect(body.apify.configured).toBe(true);
      expect(body.apify.updatedAt).toBe(FAKE_UPDATED_AT);

      // REQ-024: secret never in status response
      const bodyText = JSON.stringify(body);
      expect(bodyText).not.toContain(TOKEN_SENTINEL);
    });

    it("REQ-024: status body contains no token-shaped value after upsert", async () => {
      // Arrange: upsert then GET status
      const repo = makeRepo({
        getStatus: vi.fn().mockResolvedValue({
          linkedinClient: { configured: false, apiVersion: null, updatedAt: null },
          twitterCollector: { configured: false, updatedAt: null },
          twitterClient: { configured: false, updatedAt: null },
          apify: { configured: true, updatedAt: FAKE_UPDATED_AT },
        } satisfies AppCredentialsStatus),
      });
      const app = buildApp(repo);

      // First upsert
      await app.request("/api/super/app-credentials/apify", {
        method: "PUT",
        headers: { cookie: superCookie(), "content-type": "application/json" },
        body: JSON.stringify({ apiToken: TOKEN_SENTINEL }),
      });

      // Then GET status
      const statusRes = await app.request("/api/super/app-credentials", {
        headers: { cookie: superCookie() },
      });
      const statusText = await statusRes.text();
      expect(statusText).not.toContain(TOKEN_SENTINEL);
    });
  });

  describe("test_REQ_018_delete_apify_credential — DELETE removes row; subsequent status configured:false", () => {
    it("DELETE /apify returns 200 with removed:true when row exists", async () => {
      const repo = makeRepo({ delete: vi.fn().mockResolvedValue(true) });
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "DELETE",
        headers: { cookie: superCookie() },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; removed: boolean };
      expect(body.ok).toBe(true);
      expect(body.removed).toBe(true);
      expect(repo.delete).toHaveBeenCalledWith("apify_api_token");
    });

    it("DELETE /apify returns removed:false when no row", async () => {
      const repo = makeRepo({ delete: vi.fn().mockResolvedValue(false) });
      const app = buildApp(repo);

      const res = await app.request("/api/super/app-credentials/apify", {
        method: "DELETE",
        headers: { cookie: superCookie() },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(false);
    });

    it("after DELETE, status returns configured:false", async () => {
      // We have two separate calls — after DELETE the repo's getStatus returns configured:false.
      // Simulate: first call returns configured:true; after delete -> configured:false.
      let deleteHappened = false;
      const repo = makeRepo({
        getStatus: vi.fn().mockImplementation(() =>
          Promise.resolve({
            linkedinClient: { configured: false, apiVersion: null, updatedAt: null },
            twitterCollector: { configured: false, updatedAt: null },
            twitterClient: { configured: false, updatedAt: null },
            apify: deleteHappened
              ? { configured: false, updatedAt: null }
              : { configured: true, updatedAt: FAKE_UPDATED_AT },
          }),
        ),
        delete: vi.fn().mockImplementation((_key: AppCredentialKey) => {
          deleteHappened = true;
          return Promise.resolve(true);
        }),
      });
      const app = buildApp(repo);

      // Status before delete: configured
      const before = (await (
        await app.request("/api/super/app-credentials", { headers: { cookie: superCookie() } })
      ).json()) as AppCredentialsStatus;
      expect(before.apify.configured).toBe(true);

      // Delete
      await app.request("/api/super/app-credentials/apify", {
        method: "DELETE",
        headers: { cookie: superCookie() },
      });

      // Status after delete: not configured
      const after = (await (
        await app.request("/api/super/app-credentials", { headers: { cookie: superCookie() } })
      ).json()) as AppCredentialsStatus;
      expect(after.apify.configured).toBe(false);
    });
  });
});

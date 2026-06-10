import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createAdminSocialCredentialsRouter } from "../admin-social-credentials.js";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import { getCredentialCipher, type CredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { SocialTokenRecord, SocialPlatform, SaveSocialTokenInput } from "../../repositories/social-tokens.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";

// ── In-memory token repo for tests ─────────────────────────────────────────

interface InMemoryTokenRow {
  platform: "linkedin" | "twitter";
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

function makeTokenRepo(): {
  repo: import("../../repositories/social-tokens.js").SocialTokensRepo;
  rows: Map<string, InMemoryTokenRow>;
} {
  const rows = new Map<string, InMemoryTokenRow>();
  const repo: import("../../repositories/social-tokens.js").SocialTokensRepo = {
    async saveToken(platform: SocialPlatform, input: SaveSocialTokenInput): Promise<void> {
      rows.set(platform, {
        platform,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
      });
    },
    async getLinkedIn(): Promise<SocialTokenRecord | null> {
      const row = rows.get("linkedin");
      if (!row) return null;
      return {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresAt: row.expiresAt,
        metadata: null,
      };
    },
    async deleteToken(platform: SocialPlatform): Promise<boolean> {
      return rows.delete(platform);
    },
  };
  return { repo, rows };
}

function buildProtectedApp(getTokenRepo: () => import("../../repositories/social-tokens.js").SocialTokensRepo): Hono {
  const app = new Hono();
  app.use("/api/admin/social-credentials/*", requireAdmin(SESSION_SECRET));
  app.use("/api/admin/social-credentials", requireAdmin(SESSION_SECRET));
  app.route(
    "/api/admin/social-credentials",
    createAdminSocialCredentialsRouter({ getTokenRepo }),
  );
  return app;
}

function authCookie(): string {
  const token = issueToken(SESSION_SECRET);
  return `${COOKIE_NAME}=${token}`;
}

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
});

describe("admin-social-credentials router — VS-12.10: auth gating", () => {
  it("GET /api/admin/social-credentials without cookie → 401", async () => {
    const { repo } = makeTokenRepo();
    const app = buildProtectedApp(() => repo);
    const res = await app.request("/api/admin/social-credentials");
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/social-credentials with cookie → 200", async () => {
    const { repo } = makeTokenRepo();
    const app = buildProtectedApp(() => repo);
    const res = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
  });
});

describe("admin-social-credentials router — VS-12.11: token connection status", () => {
  it("returns linkedin.connected=false when no token exists", async () => {
    const { repo } = makeTokenRepo();
    const app = buildProtectedApp(() => repo);
    const res = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    const body = await res.json() as { linkedin: { connected: boolean; expiresAt: string | null } };
    expect(body.linkedin.connected).toBe(false);
    expect(body.linkedin.expiresAt).toBeNull();
  });

  it("returns linkedin.connected=true with expiresAt when token exists", async () => {
    const { repo, rows } = makeTokenRepo();
    const expires = new Date("2026-12-31T12:00:00Z");
    rows.set("linkedin", {
      platform: "linkedin",
      accessToken: "at-secret",
      refreshToken: "rt-secret",
      expiresAt: expires,
    });
    const app = buildProtectedApp(() => repo);
    const res = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    const body = await res.json() as { linkedin: { connected: boolean; expiresAt: string | null } };
    expect(body.linkedin.connected).toBe(true);
    expect(body.linkedin.expiresAt).toBe(expires.toISOString());
  });

  it("never leaks access tokens in response", async () => {
    const { repo, rows } = makeTokenRepo();
    rows.set("linkedin", {
      platform: "linkedin",
      accessToken: "secret-at-value",
      refreshToken: "secret-rt-value",
      expiresAt: new Date(),
    });
    const app = buildProtectedApp(() => repo);
    const res = await app.request("/api/admin/social-credentials", {
      headers: { cookie: authCookie() },
    });
    const body = await res.json();
    const stringified = JSON.stringify(body);
    expect(stringified).not.toContain("secret-at-value");
    expect(stringified).not.toContain("secret-rt-value");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { TenantContext, TenantRow } from "@newsletter/shared";
import type { TenantVariables } from "../../middleware/types.js";
import type {
  CredentialCipher,
  EncryptedBlob,
} from "@newsletter/shared/services/credential-cipher";
import {
  createTenantSettingsRouter,
  type TenantSettingsRepo,
  type TenantSettingsUpdate,
} from "../tenant-settings.js";

const CTX: TenantContext = { tenantId: "t1", role: "tenant_admin" };

function baseRow(): TenantRow {
  return {
    id: "t1",
    slug: "acme",
    previousSlug: null,
    status: "active",
    name: "Acme",
    headline: "Acme News",
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    logoVersion: 0,
    customDomain: null,
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
    builtPageEnabled: false,
    notificationEmail: null,
    slackWebhook: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRepo(row: TenantRow | null): {
  repo: TenantSettingsRepo;
  current: () => TenantRow | null;
} {
  let state = row;
  const repo: TenantSettingsRepo = {
    getById: (id) => Promise.resolve(state?.id === id ? state : null),
    updateSettings: (id, update: TenantSettingsUpdate) => {
      if (state?.id !== id) throw new Error("not found");
      state = { ...state, ...update };
      return Promise.resolve(state);
    },
  };
  return { repo, current: () => state };
}

const fakeCipher: CredentialCipher = {
  encrypt: (plaintext): EncryptedBlob => ({
    ct: `ct:${plaintext}`,
    iv: "iv",
    tag: "tag",
  }),
  decrypt: (blob) => blob.ct.replace(/^ct:/, ""),
};

function build(repo: TenantSettingsRepo): Hono<{ Variables: TenantVariables }> {
  const router = createTenantSettingsRouter({
    getTenantsRepo: () => repo,
    cipher: fakeCipher,
  });
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    c.set("tenantCtx", CTX);
    await next();
  });
  app.route("/", router);
  return app;
}

describe("tenant-settings router", () => {
  let repo: TenantSettingsRepo;
  let current: () => TenantRow | null;

  beforeEach(() => {
    ({ repo, current } = makeRepo(baseRow()));
  });

  it("GET / returns branding/flags and never exposes shortlist size", async () => {
    const app = build(repo);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("Acme");
    expect(body.canonEnabled).toBe(false);
    expect(body.slackWebhookConfigured).toBe(false);
    expect(body).not.toHaveProperty("shortlistSize");
    expect(body).not.toHaveProperty("slackWebhook");
  });

  it("GET / returns 404 when tenant missing", async () => {
    const { repo: empty } = makeRepo(null);
    const app = build(empty);
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });

  it("PATCH / updates branding and flags", async () => {
    const app = build(repo);
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name", canonEnabled: true }),
    });
    expect(res.status).toBe(200);
    expect(current()?.name).toBe("New Name");
    expect(current()?.canonEnabled).toBe(true);
  });

  it("PATCH / stores the slack webhook encrypted", async () => {
    const app = build(repo);
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slackWebhook: "https://hooks.slack.com/x" }),
    });
    expect(res.status).toBe(200);
    const stored = current()?.slackWebhook;
    expect(stored).toEqual({
      ct: "ct:https://hooks.slack.com/x",
      iv: "iv",
      tag: "tag",
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slackWebhookConfigured).toBe(true);
  });

  it("PATCH / clears the slack webhook when null", async () => {
    ({ repo, current } = makeRepo({
      ...baseRow(),
      slackWebhook: { ct: "ct:old", iv: "iv", tag: "tag" },
    }));
    const app = build(repo);
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slackWebhook: null }),
    });
    expect(res.status).toBe(200);
    expect(current()?.slackWebhook).toBeNull();
  });

  it("PATCH / sets the notification email", async () => {
    const app = build(repo);
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationEmail: "ops@acme.com" }),
    });
    expect(res.status).toBe(200);
    expect(current()?.notificationEmail).toBe("ops@acme.com");
  });

  it("PATCH / rejects an invalid notification email", async () => {
    const app = build(repo);
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationEmail: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH / rejects shortlistSize (not an allowed field)", async () => {
    const app = build(repo);
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortlistSize: 42 }),
    });
    expect(res.status).toBe(400);
  });
});

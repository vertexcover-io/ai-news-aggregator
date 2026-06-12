import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { setTestTenant, TEST_TENANT_ID } from "../../helpers/tenant.js";
import { createBrandingRouter } from "@api/routes/branding.js";
import { MAX_LOGO_BYTES } from "@api/lib/logo-validation.js";
import type {
  TenantBrandingRecord,
  TenantBrandingUpdate,
} from "@api/repositories/tenants.js";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const LOGO_BYTE_CAP: number = MAX_LOGO_BYTES;

function fakeRepo(initial: Partial<TenantBrandingRecord> = {}) {
  const row: TenantBrandingRecord = {
    id: TEST_TENANT_ID,
    slug: "agentloop",
    name: "AGENTLOOP",
    status: "active",
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoVersion: 0,
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
    ...initial,
  };
  let storedLogo: { bytes: Buffer; contentType: string } | null = null;
  const repo = {
    updateBranding: vi.fn((_id: string, patch: TenantBrandingUpdate) => {
      Object.assign(row, patch);
      return Promise.resolve({ ...row });
    }),
    setLogo: vi.fn((_id: string, bytes: Buffer, contentType: string) => {
      storedLogo = { bytes, contentType };
      const current: number = row.logoVersion;
      row.logoVersion = current + 1;
      return Promise.resolve(row.logoVersion);
    }),
  };
  return { repo, row, getStoredLogo: () => storedLogo };
}

function buildApp(repo: ReturnType<typeof fakeRepo>["repo"]): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  app.route("/api/admin/branding", createBrandingRouter({ tenantsRepo: repo }));
  return app;
}

function putJson(app: Hono, body: unknown): Promise<Response> {
  return app.request("/api/admin/branding", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putLogo(
  app: Hono,
  bytes: Uint8Array,
  contentType = "application/octet-stream",
): Promise<Response> {
  return app.request("/api/admin/branding/logo", {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
  });
}

describe("PUT /api/admin/branding", () => {
  it("updates name/headline/topicStrip/subtagline and returns the new branding", async () => {
    const { repo } = fakeRepo();
    const res = await putJson(buildApp(repo), {
      name: "The Inference",
      headline: "Daily inference reading.",
      topicStrip: "SERVING · LATENCY",
      subtagline: "Just the runtime.",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "The Inference",
      headline: "Daily inference reading.",
      topicStrip: "SERVING · LATENCY",
      subtagline: "Just the runtime.",
      logoVersion: 0,
    });
    expect(repo.updateBranding).toHaveBeenCalledWith(TEST_TENANT_ID, {
      name: "The Inference",
      headline: "Daily inference reading.",
      topicStrip: "SERVING · LATENCY",
      subtagline: "Just the runtime.",
    });
  });

  it("accepts a partial update and allows clearing the subtagline", async () => {
    const { repo } = fakeRepo({ subtagline: "old" });
    const res = await putJson(buildApp(repo), { subtagline: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subtagline: string | null };
    expect(body.subtagline).toBeNull();
  });

  it("rejects an empty body with 400 and never writes", async () => {
    const { repo } = fakeRepo();
    const res = await putJson(buildApp(repo), {});
    expect(res.status).toBe(400);
    expect(repo.updateBranding).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and blank name with 400", async () => {
    const { repo } = fakeRepo();
    const app = buildApp(repo);
    expect((await putJson(app, { bogus: "x" })).status).toBe(400);
    expect((await putJson(app, { name: "   " })).status).toBe(400);
    expect(repo.updateBranding).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/branding/logo", () => {
  it("accepts a valid PNG, stores it with its sniffed content type, and bumps logoVersion", async () => {
    const { repo, getStoredLogo } = fakeRepo({ logoVersion: 2 });
    const bytes = new Uint8Array([...PNG_HEADER, 0, 0, 0, 0]);
    const res = await putLogo(buildApp(repo), bytes);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logoVersion: 3 });
    expect(getStoredLogo()).toEqual({
      bytes: Buffer.from(bytes),
      contentType: "image/png",
    });
  });

  it("accepts a multipart upload with a 'logo' file field", async () => {
    const { repo } = fakeRepo();
    const form = new FormData();
    form.append(
      "logo",
      new File([new Uint8Array(PNG_HEADER)], "logo.png", { type: "image/png" }),
    );
    const res = await buildApp(repo).request("/api/admin/branding/logo", {
      method: "PUT",
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logoVersion: 1 });
  });

  it("rejects a disallowed type (GIF) with 422 and keeps the existing logo (EDGE-007)", async () => {
    const { repo, getStoredLogo } = fakeRepo({ logoVersion: 5 });
    const res = await putLogo(
      buildApp(repo),
      new TextEncoder().encode("GIF89a"),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "invalid_logo",
      reason: "unsupported_type",
    });
    expect(repo.setLogo).not.toHaveBeenCalled();
    expect(getStoredLogo()).toBeNull();
  });

  it("rejects an oversized payload with 422 without writing (REQ-039)", async () => {
    const { repo } = fakeRepo();
    const bytes = new Uint8Array(LOGO_BYTE_CAP + 1);
    bytes.set(PNG_HEADER, 0);
    const res = await putLogo(buildApp(repo), bytes);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "invalid_logo",
      reason: "too_large",
    });
    expect(repo.setLogo).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 422", async () => {
    const { repo } = fakeRepo();
    const res = await putLogo(buildApp(repo), new Uint8Array(0));
    expect(res.status).toBe(422);
    expect(repo.setLogo).not.toHaveBeenCalled();
  });

  it("rejects an unsafe SVG with 422", async () => {
    const { repo } = fakeRepo();
    const res = await putLogo(
      buildApp(repo),
      new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "invalid_logo",
      reason: "unsafe_svg",
    });
    expect(repo.setLogo).not.toHaveBeenCalled();
  });
});

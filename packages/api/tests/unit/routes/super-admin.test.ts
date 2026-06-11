import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// RED phase: test the super-admin route module before it exists.
// Once the module is created, these imports will resolve.

describe("Phase 6: Super-admin routes (RED)", () => {
  describe("GET /api/super/tenants", () => {
    it("REQ-100: super admin can list all tenants", async () => {
      // Build a test app with the super-admin router mounted
      const { createSuperAdminRouter } = await import(
        "@api/routes/super-admin.js"
      );

      const app = new Hono();
      const router = createSuperAdminRouter({
        getTenants: async () => [
          { id: "t1", slug: "tenant-a", name: "Tenant A", status: "active", createdAt: new Date() },
          { id: "t2", slug: "tenant-b", name: "Tenant B", status: "pending_setup", createdAt: new Date() },
        ],
      });
      app.route("/api/super", router);

      const res = await app.request("/api/super/tenants");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tenants).toHaveLength(2);
      expect(body.tenants[0].slug).toBe("tenant-a");
    });

    it("REQ-082: tenant responses never expose app-level secrets", async () => {
      const { createSuperAdminRouter } = await import(
        "@api/routes/super-admin.js"
      );

      const app = new Hono();
      const router = createSuperAdminRouter({
        getTenants: async () => [
          { id: "t1", slug: "test", name: "Test", status: "active", createdAt: new Date() },
        ],
      });
      app.route("/api/super", router);

      const res = await app.request("/api/super/tenants");
      const body = await res.json();
      // No secret fields should be present
      expect(JSON.stringify(body)).not.toContain("secret");
      expect(JSON.stringify(body)).not.toContain("password");
      expect(JSON.stringify(body)).not.toContain("token");
    });
  });

  describe("POST /api/super/impersonate/:tenantId", () => {
    it("REQ-101: impersonation sets acting tenant context", async () => {
      const { createSuperAdminRouter } = await import(
        "@api/routes/super-admin.js"
      );

      let impersonatedTenantId: string | undefined;
      const app = new Hono();
      const router = createSuperAdminRouter({
        getTenantById: async (id) => ({
          id, slug: "target", name: "Target", status: "active", createdAt: new Date(),
        }),
        startImpersonation: async (tenantId) => {
          impersonatedTenantId = tenantId;
        },
      });
      app.route("/api/super", router);

      const res = await app.request("/api/super/impersonate/t1", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(impersonatedTenantId).toBe("t1");
    });

    it("REQ-101: impersonating non-existent tenant returns 404", async () => {
      const { createSuperAdminRouter } = await import(
        "@api/routes/super-admin.js"
      );

      const app = new Hono();
      const router = createSuperAdminRouter({
        getTenantById: async () => null,
        startImpersonation: async () => {},
      });
      app.route("/api/super", router);

      const res = await app.request("/api/super/impersonate/nonexistent", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/super/impersonate/exit", () => {
    it("REQ-102: exit clears impersonation context", async () => {
      const { createSuperAdminRouter } = await import(
        "@api/routes/super-admin.js"
      );

      let exitCalled = false;
      const app = new Hono();
      const router = createSuperAdminRouter({
        exitImpersonation: async () => {
          exitCalled = true;
        },
      });
      app.route("/api/super", router);

      const res = await app.request("/api/super/impersonate/exit", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(exitCalled).toBe(true);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  classifyHost,
  isValidSlug,
  buildResolveTenantConfig,
} from "@api/middleware/resolve-tenant.js";

describe("Phase 5: Host → tenant resolution", () => {
  describe("Config: buildResolveTenantConfig", () => {
    it("REQ-020/021: reads ROOT_DOMAIN and APP_HOST from env", () => {
      const cfg = buildResolveTenantConfig({
        ROOT_DOMAIN: "vertexcover.io",
        APP_SUBDOMAIN: "app",
      });
      expect(cfg.rootDomain).toBe("vertexcover.io");
      expect(cfg.appSubdomain).toBe("app");
      expect(cfg.customDomainMap).toEqual({});
    });

    it("REQ-022: parses CUSTOM_DOMAIN_MAP from env", () => {
      const cfg = buildResolveTenantConfig({
        ROOT_DOMAIN: "vertexcover.io",
        APP_SUBDOMAIN: "app",
        CUSTOM_DOMAIN_MAP: "agentloop.ai=tenant0-uuid",
      });
      expect(cfg.customDomainMap["agentloop.ai"]).toBe("tenant0-uuid");
    });

    it("REQ-022: parses multiple custom domain entries", () => {
      const cfg = buildResolveTenantConfig({
        ROOT_DOMAIN: "vertexcover.io",
        APP_SUBDOMAIN: "app",
        CUSTOM_DOMAIN_MAP: "a.com=id-a,b.com=id-b",
      });
      expect(cfg.customDomainMap["a.com"]).toBe("id-a");
      expect(cfg.customDomainMap["b.com"]).toBe("id-b");
    });
  });

  describe("classifyHost", () => {
    const cfg = {
      rootDomain: "vertexcover.io",
      appSubdomain: "app",
      customDomainMap: { "agentloop.ai": "tenant-0-uuid" },
    };

    it("REQ-020: app.vertexcover.io → type 'app'", () => {
      const result = classifyHost("app.vertexcover.io", cfg);
      expect(result.type).toBe("app");
    });

    it("REQ-020: app.vertexcover.io:3000 (with port) → type 'app'", () => {
      const result = classifyHost("app.vertexcover.io:3000", cfg);
      expect(result.type).toBe("app");
    });

    it("REQ-021: mytenant.vertexcover.io → type 'slug'", () => {
      const result = classifyHost("mytenant.vertexcover.io", cfg);
      expect(result.type).toBe("slug");
      expect(result.slug).toBe("mytenant");
    });

    it("REQ-021: hyphenated-slug.vertexcover.io → slug extracted", () => {
      const result = classifyHost("my-tenant.vertexcover.io", cfg);
      expect(result.type).toBe("slug");
      expect(result.slug).toBe("my-tenant");
    });

    it("EDGE-013: bare root domain → type 'unknown'", () => {
      const result = classifyHost("vertexcover.io", cfg);
      expect(result.type).toBe("unknown");
    });

    it("REQ-022: custom domain agentloop.ai → type 'custom'", () => {
      const result = classifyHost("agentloop.ai", cfg);
      expect(result.type).toBe("custom");
      expect(result.tenantId).toBe("tenant-0-uuid");
    });

    it("EDGE-013: unknown domain → type 'unknown'", () => {
      const result = classifyHost("random.com", cfg);
      expect(result.type).toBe("unknown");
    });
  });

  describe("isValidSlug", () => {
    it("valid: lowercase alphanumeric + hyphen", () => {
      expect(isValidSlug("my-newsletter")).toBe(true);
      expect(isValidSlug("tenant1")).toBe(true);
      expect(isValidSlug("a-b-c")).toBe(true);
    });

    it("invalid: uppercase", () => {
      expect(isValidSlug("MyNewsletter")).toBe(false);
    });

    it("invalid: underscore", () => {
      expect(isValidSlug("my_newsletter")).toBe(false);
    });

    it("invalid: empty string", () => {
      expect(isValidSlug("")).toBe(false);
    });

    it("invalid: starts or ends with hyphen", () => {
      expect(isValidSlug("-start")).toBe(false);
      expect(isValidSlug("end-")).toBe(false);
    });
  });
});

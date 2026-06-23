import { afterEach, describe, expect, it, vi } from "vitest";
import { hostSurfaceFor } from "../../../src/lib/hostSurface";

/**
 * `hostSurfaceFor` decides whether a host is the platform app surface (serves
 * the product landing at `/`) or a tenant surface (serves a tenant newsletter
 * `HomePage` at `/`). The dev rules (loopback + lvh.me) need no env; the prod
 * rules read the baked-in `VITE_PUBLIC_ROOT_DOMAIN` / `VITE_APP_HOST`.
 */
describe("hostSurfaceFor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("local dev (no configured root domain)", () => {
    it("treats loopback hosts as the app surface", () => {
      expect(hostSurfaceFor("localhost")).toBe("app");
      expect(hostSurfaceFor("localhost:5173")).toBe("app");
      expect(hostSurfaceFor("127.0.0.1")).toBe("app");
      expect(hostSurfaceFor("[::1]:5173")).toBe("app");
    });

    it("treats the lvh.me apex and reserved app label as the app surface", () => {
      expect(hostSurfaceFor("lvh.me:5173")).toBe("app");
      expect(hostSurfaceFor("app.lvh.me:5173")).toBe("app");
    });

    it("treats a single-label *.lvh.me host as a tenant surface", () => {
      expect(hostSurfaceFor("inference.lvh.me:5173")).toBe("tenant");
      expect(hostSurfaceFor("INFERENCE.LVH.ME:5173")).toBe("tenant");
    });
  });

  describe("production (configured root domain)", () => {
    function withRoot(root: string, appHost?: string): void {
      vi.stubEnv("VITE_PUBLIC_ROOT_DOMAIN", root);
      if (appHost !== undefined) vi.stubEnv("VITE_APP_HOST", appHost);
    }

    it("treats the apex and app.<root> as the app surface", () => {
      withRoot("agentloop.live");
      expect(hostSurfaceFor("agentloop.live")).toBe("app");
      expect(hostSurfaceFor("app.agentloop.live")).toBe("app");
    });

    it("treats <slug>.<root> as a tenant surface", () => {
      withRoot("agentloop.live");
      expect(hostSurfaceFor("inference.agentloop.live")).toBe("tenant");
    });

    it("treats an arbitrary custom domain as a tenant surface (never the landing)", () => {
      withRoot("agentloop.live");
      expect(hostSurfaceFor("news.acme.com")).toBe("tenant");
      // Even a custom domain that happens to start with "app." is a tenant,
      // because the configured root domain is authoritative.
      expect(hostSurfaceFor("app.acme.com")).toBe("tenant");
    });

    it("honours an explicit VITE_APP_HOST override", () => {
      withRoot("agentloop.live", "dashboard.agentloop.live");
      expect(hostSurfaceFor("dashboard.agentloop.live")).toBe("app");
    });

    it("ignores the placeholder root and falls back to the app.* heuristic", () => {
      withRoot("ourdomain.com");
      expect(hostSurfaceFor("app.agentloop.live")).toBe("app");
      expect(hostSurfaceFor("inference.agentloop.live")).toBe("tenant");
    });
  });

  it("defaults empty input to a tenant surface", () => {
    expect(hostSurfaceFor("")).toBe("tenant");
  });
});

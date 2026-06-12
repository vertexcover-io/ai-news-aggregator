/**
 * Unit: domain config parsing for the host→tenant resolver (P5).
 * Supports REQ-020/021/022 — classification depends on this env parsing.
 */
import { describe, it, expect } from "vitest";
import { loadDomainConfig, normalizeHost } from "@api/config/domains.js";

describe("normalizeHost", () => {
  it.each([
    ["Foo.Bar:8080", "foo.bar"],
    ["  News.Example.COM  ", "news.example.com"],
    ["localhost:5173", "localhost"],
    ["[::1]:3000", "::1"],
    ["plain.host", "plain.host"],
    ["", ""],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});

describe("loadDomainConfig", () => {
  it("production: ROOT_DOMAIN derives app.<root>, no dev overrides", () => {
    const cfg = loadDomainConfig({
      NODE_ENV: "production",
      ROOT_DOMAIN: "Agentloop.Live",
    });
    expect(cfg.rootDomains).toEqual(["agentloop.live"]);
    expect(cfg.appHosts.has("app.agentloop.live")).toBe(true);
    expect(cfg.appHosts.has("localhost")).toBe(true); // liveness probes
    expect(cfg.appHosts.has("app.lvh.me")).toBe(false);
    expect(cfg.rootDomains).not.toContain("lvh.me");
    expect(cfg.allowDevOverrides).toBe(false);
  });

  it("dev (NODE_ENV unset): lvh.me root + header override enabled", () => {
    const cfg = loadDomainConfig({ ROOT_DOMAIN: "agentloop.live" });
    expect(cfg.allowDevOverrides).toBe(true);
    expect(cfg.rootDomains).toContain("lvh.me");
    expect(cfg.appHosts.has("app.lvh.me")).toBe(true);
  });

  it("explicit APP_HOST csv replaces the app.<root> default", () => {
    const cfg = loadDomainConfig({
      NODE_ENV: "production",
      ROOT_DOMAIN: "agentloop.live",
      APP_HOST: "dash.agentloop.live, ops.agentloop.live:443",
    });
    expect(cfg.appHosts.has("dash.agentloop.live")).toBe(true);
    expect(cfg.appHosts.has("ops.agentloop.live")).toBe(true);
    expect(cfg.appHosts.has("app.agentloop.live")).toBe(false);
  });

  it("CUSTOM_DOMAIN_MAP parses host=slug pairs and skips malformed entries", () => {
    const cfg = loadDomainConfig({
      NODE_ENV: "production",
      CUSTOM_DOMAIN_MAP:
        "News.Vertexcover.IO=agentloop, other.io=foo, malformed, =noslug",
    });
    expect(cfg.customDomainMap.get("news.vertexcover.io")).toBe("agentloop");
    expect(cfg.customDomainMap.get("other.io")).toBe("foo");
    expect(cfg.customDomainMap.size).toBe(2);
  });
});

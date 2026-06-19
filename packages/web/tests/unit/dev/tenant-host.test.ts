import { describe, expect, it } from "vitest";
import { devTenantSlugFromHost } from "../../../src/dev/tenant-host";

describe("devTenantSlugFromHost", () => {
  it("extracts the slug label from a *.lvh.me host", () => {
    expect(devTenantSlugFromHost("inference.lvh.me:5173")).toBe("inference");
  });

  it("strips the port and lowercases", () => {
    expect(devTenantSlugFromHost("INFERENCE.LVH.ME:5173")).toBe("inference");
  });

  it("works without a port", () => {
    expect(devTenantSlugFromHost("inference.lvh.me")).toBe("inference");
  });

  it("returns undefined for the reserved app label (admin surface)", () => {
    expect(devTenantSlugFromHost("app.lvh.me:5173")).toBeUndefined();
  });

  it("returns undefined for bare localhost (tenant-0 / app host)", () => {
    expect(devTenantSlugFromHost("localhost:5173")).toBeUndefined();
  });

  it("returns undefined for a loopback IP host", () => {
    expect(devTenantSlugFromHost("127.0.0.1:3000")).toBeUndefined();
  });

  it("returns undefined for the bare lvh.me apex (no subdomain label)", () => {
    expect(devTenantSlugFromHost("lvh.me:5173")).toBeUndefined();
  });

  it("returns undefined for a multi-label subdomain (deeper nesting is not a slug)", () => {
    expect(devTenantSlugFromHost("a.b.lvh.me:5173")).toBeUndefined();
  });

  it("returns undefined for a non-lvh.me host", () => {
    expect(devTenantSlugFromHost("inference.example.com:5173")).toBeUndefined();
  });

  it("returns undefined for undefined/empty input", () => {
    expect(devTenantSlugFromHost(undefined)).toBeUndefined();
    expect(devTenantSlugFromHost("")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { canonicalizeFetchUrl, isPrivateOrLoopbackHost } from "@shared/services/url-safety.js";

describe("isPrivateOrLoopbackHost", () => {
  it("returns true for loopback / private / link-local hosts", () => {
    const truthy = [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "[::1]",
      "[fc00::]",
      "0.0.0.0",
    ];
    for (const h of truthy) {
      expect(isPrivateOrLoopbackHost(h), `expected ${h} to be private/loopback`).toBe(true);
    }
  });

  it("returns false for public hosts and IPs just outside the private ranges", () => {
    const falsy = [
      "example.com",
      "1.1.1.1",
      "8.8.8.8",
      "192.169.1.1",
      "172.32.0.1",
    ];
    for (const h of falsy) {
      expect(isPrivateOrLoopbackHost(h), `expected ${h} to be public`).toBe(false);
    }
  });
});

describe("canonicalizeFetchUrl", () => {
  it("returns null for non-http(s) schemes and SSRF targets", () => {
    expect(canonicalizeFetchUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeFetchUrl("file:///etc/passwd")).toBeNull();
    expect(canonicalizeFetchUrl("http://localhost/")).toBeNull();
    expect(canonicalizeFetchUrl("http://10.0.0.1/")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(canonicalizeFetchUrl("not-a-url")).toBeNull();
  });

  it("lowercases the hostname and preserves the path", () => {
    expect(canonicalizeFetchUrl("HTTPS://EXAMPLE.COM/Path")).toBe("https://example.com/Path");
  });
});

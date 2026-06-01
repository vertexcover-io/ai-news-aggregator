import { describe, it, expect } from "vitest";
import { parseProxyForPlaywright } from "@pipeline/services/web-fetch/fetch-browser.js";

describe("parseProxyForPlaywright (REQ-003, REQ-007, EDGE-006)", () => {
  it("maps a credentialed http URL to { server, username, password } (REQ-003)", () => {
    expect(parseProxyForPlaywright("http://u:p@h:5863/")).toEqual({
      server: "http://h:5863",
      username: "u",
      password: "p",
    });
  });

  it("decodes URL-encoded credentials (EDGE-006)", () => {
    expect(parseProxyForPlaywright("http://a%40b:p%3As@h:1")).toEqual({
      server: "http://h:1",
      username: "a@b",
      password: "p:s",
    });
  });

  it("omits username/password keys for a no-credential proxy", () => {
    const result = parseProxyForPlaywright("http://h:1");
    expect(result).toEqual({ server: "http://h:1" });
    expect("username" in result).toBe(false);
    expect("password" in result).toBe(false);
  });

  it("preserves the https protocol in server", () => {
    // WHATWG URL strips the default https port (443) from u.host, so the
    // implementation's `${protocol}//${host}` yields "https://h".
    expect(parseProxyForPlaywright("https://h:443")).toEqual({
      server: "https://h",
    });
  });

  it("preserves an https protocol and non-default port in server", () => {
    expect(parseProxyForPlaywright("https://h:8443")).toEqual({
      server: "https://h:8443",
    });
  });
});

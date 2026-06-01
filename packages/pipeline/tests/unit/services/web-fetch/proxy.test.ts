import { describe, it, expect, vi, afterEach } from "vitest";
import { ProxyAgent } from "undici";
import { resolveWebProxyUrl } from "@pipeline/services/web-fetch/proxy.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveWebProxyUrl (REQ-001, EDGE-001, EDGE-002)", () => {
  it("returns the exact trimmed value for a valid http URL with credentials", () => {
    const url = "http://u:p@h:1";
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: url })).toBe(url);
  });

  it("returns the exact value for a valid https URL", () => {
    const url = "https://h:443";
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: url })).toBe(url);
  });

  it("trims surrounding whitespace and returns the inner valid URL", () => {
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: "  http://h:8080  " })).toBe(
      "http://h:8080",
    );
  });

  it("returns null when WEB_HTTP_PROXY is unset (REQ-005)", () => {
    expect(resolveWebProxyUrl({})).toBeNull();
  });

  it("returns null for an empty string (EDGE-001)", () => {
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: "" })).toBeNull();
  });

  it("returns null for a whitespace-only string (EDGE-001)", () => {
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: "   " })).toBeNull();
  });

  it("returns null and does not throw for a malformed URL (EDGE-002)", () => {
    expect(() =>
      resolveWebProxyUrl({ WEB_HTTP_PROXY: "not a url" }),
    ).not.toThrow();
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: "not a url" })).toBeNull();
  });

  it("returns null for a non-http(s) protocol", () => {
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: "ftp://h" })).toBeNull();
  });

  it("never includes the proxy value in any log line written to stdout (REQ-007)", () => {
    // Unparseable on purpose (no scheme) so the malformed-warn branch fires;
    // the embedded credential must never appear in any emitted log line.
    const secret = "ht tp://supersecretpass";
    let captured = "";
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        captured += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      });
    // malformed (has a space) → triggers the warn branch on the module logger
    expect(resolveWebProxyUrl({ WEB_HTTP_PROXY: secret })).toBeNull();
    writeSpy.mockRestore();
    expect(captured).not.toContain("supersecretpass");
    expect(captured).not.toContain(secret);
  });

  it("never throws (so credentials can never leak via an error message)", () => {
    expect(() =>
      resolveWebProxyUrl({ WEB_HTTP_PROXY: "://::malformed::" }),
    ).not.toThrow();
  });
});

describe("undici ProxyAgent is importable (REQ-008)", () => {
  it("constructs a ProxyAgent from a proxy URL", () => {
    const agent = new ProxyAgent("http://127.0.0.1:8080");
    expect(agent).toBeInstanceOf(ProxyAgent);
  });
});

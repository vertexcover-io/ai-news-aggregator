import { describe, expect, it } from "vitest";
import { createProxyFetch } from "@pipeline/lib/proxy-fetch.js";

describe("createProxyFetch", () => {
  // VS-1
  it("returns globalThis.fetch when proxyUrl is undefined", () => {
    expect(createProxyFetch(undefined)).toBe(globalThis.fetch);
  });

  // VS-2
  it("returns globalThis.fetch when proxyUrl is empty string", () => {
    expect(createProxyFetch("")).toBe(globalThis.fetch);
  });

  // VS-3
  it("returns globalThis.fetch when proxyUrl is whitespace only", () => {
    expect(createProxyFetch("   ")).toBe(globalThis.fetch);
  });

  // VS-4
  it("returns a wrapped fetch when proxyUrl is a valid URL", () => {
    const wrapped = createProxyFetch("http://user:pass@127.0.0.1:9999");
    expect(wrapped).not.toBe(globalThis.fetch);
    expect(typeof wrapped).toBe("function");
  });
});

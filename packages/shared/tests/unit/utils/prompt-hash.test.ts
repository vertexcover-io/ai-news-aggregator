import { describe, expect, it } from "vitest";
import { hashPrompt } from "@shared/utils/prompt-hash.js";

describe("hashPrompt", () => {
  it("is deterministic for the same input", () => {
    const a = hashPrompt("rank by novelty");
    const b = hashPrompt("rank by novelty");
    expect(a).toBe(b);
  });

  it("returns a 16-character string", () => {
    expect(hashPrompt("anything").length).toBe(16);
    expect(hashPrompt("").length).toBe(16);
    expect(hashPrompt("a very long prompt ".repeat(100)).length).toBe(16);
  });

  it("returns lowercase hex characters", () => {
    expect(hashPrompt("test")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches the known sha256-truncated fixture for 'hello world'", () => {
    expect(hashPrompt("hello world")).toBe("b94d27b9934d3e08");
  });

  it("produces different hashes for different inputs", () => {
    expect(hashPrompt("a")).not.toBe(hashPrompt("b"));
  });
});

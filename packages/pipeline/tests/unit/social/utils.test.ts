import { describe, it, expect } from "vitest";
import { FAILURE_BODY_MAX, truncate } from "@pipeline/social/utils.js";

describe("FAILURE_BODY_MAX", () => {
  it("is 500", () => {
    expect(FAILURE_BODY_MAX).toBe(500);
  });
});

describe("truncate", () => {
  it("returns the string unchanged when exactly 500 characters", () => {
    const s = "a".repeat(500);
    expect(truncate(s)).toBe(s);
  });

  it("returns the string unchanged when shorter than 500 characters", () => {
    const s = "short string";
    expect(truncate(s)).toBe(s);
  });

  it("returns the string unchanged when empty", () => {
    expect(truncate("")).toBe("");
  });

  it("truncates to 500 chars followed by ellipsis when over 500 characters", () => {
    const s = "a".repeat(501);
    const result = truncate(s);
    expect(result).toBe("a".repeat(500) + "…");
  });

  it("returns a string of length 501 (500 chars + ellipsis) when input is 501 chars", () => {
    const s = "b".repeat(501);
    const result = truncate(s);
    // "…" is a single Unicode character, so length is 501
    expect([...result].length).toBe(501);
  });

  it("uses slice(0, 500) exactly (no trimEnd)", () => {
    // Differs from the shared helpers truncate which calls trimEnd
    const s = "a".repeat(499) + " x";  // 501 chars
    const result = truncate(s);
    // slice(0, 500) = "a"*499 + " ", so ellipsis appended directly
    expect(result).toBe("a".repeat(499) + " " + "…");
  });
});

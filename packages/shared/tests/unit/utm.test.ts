import { describe, it, expect } from "vitest";
import { withUtmSource, type UtmSource } from "../../src/utils/utm.js";

describe("withUtmSource", () => {
  it("test_REQ_001_withUtmSource_sets_source_param", () => {
    const result = withUtmSource("https://h/archive/x", "linkedin");
    const u = new URL(result);
    expect(u.searchParams.get("utm_source")).toBe("linkedin");
    expect(u.pathname).toBe("/archive/x");
  });

  it("test_REQ_002_UtmSource_type_is_fixed_set", () => {
    const allowed: UtmSource[] = ["email", "linkedin", "twitter"];
    for (const source of allowed) {
      const result = withUtmSource("https://h/archive/x", source);
      const u = new URL(result);
      expect(u.searchParams.get("utm_source")).toBe(source);
    }
  });

  it("test_REQ_006_withUtmSource_preserves_path_and_query", () => {
    const result = withUtmSource("https://h/archive/x?token=abc", "email");
    const u = new URL(result);
    expect(u.searchParams.get("token")).toBe("abc");
    expect(u.searchParams.get("utm_source")).toBe("email");
    expect(u.pathname).toBe("/archive/x");
  });

  it("test_REQ_008_link_build_never_throws_when_analytics_off", () => {
    // Pure function — no analytics state; must not throw regardless
    expect(() => withUtmSource("https://h/archive/x", "email")).not.toThrow();
    const result = withUtmSource("https://h/archive/x", "email");
    expect(new URL(result).searchParams.get("utm_source")).toBe("email");
  });

  it("test_EDGE_001_trailing_slash_base_single_param", () => {
    const result = withUtmSource("https://host/archive/x/", "twitter");
    const u = new URL(result);
    // Exactly one utm_source, no doubled separators
    const params = [...u.searchParams.entries()].filter(([k]) => k === "utm_source");
    expect(params).toHaveLength(1);
    expect(params[0]?.[1]).toBe("twitter");
  });

  it("test_EDGE_002_existing_query_preserved", () => {
    const result = withUtmSource(
      "https://h/archive/x?token=abc&page=2",
      "linkedin",
    );
    const u = new URL(result);
    expect(u.searchParams.get("token")).toBe("abc");
    expect(u.searchParams.get("page")).toBe("2");
    expect(u.searchParams.get("utm_source")).toBe("linkedin");
  });

  it("test_EDGE_005_absolute_base_always_valid_url", () => {
    const result = withUtmSource("https://host", "email");
    // Must produce a valid absolute URL
    expect(() => new URL(result)).not.toThrow();
    const u = new URL(result);
    expect(u.searchParams.get("utm_source")).toBe("email");
    expect(u.origin).toBe("https://host");
  });
});

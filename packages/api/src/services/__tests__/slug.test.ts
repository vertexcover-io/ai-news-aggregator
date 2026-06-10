import { describe, it, expect } from "vitest";
import { validateSlug, isReserved } from "../slug.js";

describe("validateSlug", () => {
  it("accepts lowercase alphanumeric slugs", () => {
    expect(validateSlug("acme")).toBe("available-shape");
    expect(validateSlug("acme123")).toBe("available-shape");
  });

  it("accepts hyphen-separated segments", () => {
    expect(validateSlug("acme-news")).toBe("available-shape");
    expect(validateSlug("a-b-c")).toBe("available-shape");
  });

  it("rejects slugs that are too short", () => {
    expect(validateSlug("ab")).toBe("invalid");
  });

  it("rejects slugs that are too long", () => {
    expect(validateSlug("a".repeat(64))).toBe("invalid");
  });

  it("rejects uppercase characters", () => {
    expect(validateSlug("Acme")).toBe("invalid");
  });

  it("rejects underscores and spaces and other symbols", () => {
    expect(validateSlug("acme_news")).toBe("invalid");
    expect(validateSlug("acme news")).toBe("invalid");
    expect(validateSlug("acme.news")).toBe("invalid");
  });

  it("rejects leading, trailing, and doubled hyphens", () => {
    expect(validateSlug("-acme")).toBe("invalid");
    expect(validateSlug("acme-")).toBe("invalid");
    expect(validateSlug("ac--me")).toBe("invalid");
  });

  it("rejects reserved slugs", () => {
    expect(validateSlug("admin")).toBe("invalid");
    expect(validateSlug("www")).toBe("invalid");
    expect(validateSlug("api")).toBe("invalid");
  });
});

describe("isReserved", () => {
  it("flags reserved words", () => {
    expect(isReserved("app")).toBe(true);
    expect(isReserved("mail")).toBe(true);
    expect(isReserved("cdn")).toBe(true);
  });

  it("does not flag ordinary slugs", () => {
    expect(isReserved("acme")).toBe(false);
    expect(isReserved("newsletter")).toBe(false);
  });
});

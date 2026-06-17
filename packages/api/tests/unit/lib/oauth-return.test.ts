import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "@api/lib/oauth-return.js";

const DEFAULT = "/admin/settings";

describe("sanitizeReturnTo", () => {
  it("accepts /admin relative paths", () => {
    expect(sanitizeReturnTo("/admin/settings")).toBe("/admin/settings");
    expect(sanitizeReturnTo("/admin/onboarding")).toBe("/admin/onboarding");
    expect(sanitizeReturnTo("/admin")).toBe("/admin");
  });

  it("strips a query string but keeps the /admin path", () => {
    // The OAuth callback appends its own ?platform= param, so a returnTo must
    // be a bare path — drop any query/hash a caller smuggles in.
    expect(sanitizeReturnTo("/admin/settings?tab=sources")).toBe(DEFAULT);
  });

  it("defaults to /admin/settings when absent or empty", () => {
    expect(sanitizeReturnTo(undefined)).toBe(DEFAULT);
    expect(sanitizeReturnTo("")).toBe(DEFAULT);
  });

  it("rejects open-redirect attempts → default", () => {
    expect(sanitizeReturnTo("//evil.com")).toBe(DEFAULT);
    expect(sanitizeReturnTo("https://evil.com/admin")).toBe(DEFAULT);
    expect(sanitizeReturnTo("http://evil.com")).toBe(DEFAULT);
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe(DEFAULT);
  });

  it("rejects non-admin relative paths → default", () => {
    expect(sanitizeReturnTo("/foo")).toBe(DEFAULT);
    expect(sanitizeReturnTo("/adminx")).toBe(DEFAULT);
    expect(sanitizeReturnTo("admin/settings")).toBe(DEFAULT);
  });
});

import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, TENANT_ZERO_ID } from "@shared/constants/tenant.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("tenant constants", () => {
  it("TENANT_ZERO_ID is a valid UUID", () => {
    expect(TENANT_ZERO_ID).toMatch(UUID_RE);
  });

  it("RESERVED_SLUGS contains the critical entries", () => {
    for (const slug of ["app", "www", "admin", "api", "mail"]) {
      expect(RESERVED_SLUGS).toContain(slug);
    }
  });

  it("every reserved slug is lowercase alphanumeric/hyphen", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

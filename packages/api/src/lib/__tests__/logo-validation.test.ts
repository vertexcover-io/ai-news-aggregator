import { describe, expect, it } from "vitest";
import { validateLogoUpload, ACCEPTED_LOGO_TYPES } from "../logo-validation.js";

describe("validateLogoUpload", () => {
  it("accepts a valid PNG (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(100),
      contentType: "image/png",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid JPEG (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(100),
      contentType: "image/jpeg",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid SVG (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(100),
      contentType: "image/svg+xml",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid WebP (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(100),
      contentType: "image/webp",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects oversized file (>512KB) (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(513 * 1024),
      contentType: "image/png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("512");
    }
  });

  it("rejects unsupported content type (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(100),
      contentType: "image/gif",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("unsupported");
    }
  });

  it("rejects empty content type (REQ-039)", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(100),
      contentType: "",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects zero-length buffer", () => {
    const result = validateLogoUpload({
      buffer: new Uint8Array(0),
      contentType: "image/png",
    });
    expect(result.ok).toBe(false);
  });
});

describe("ACCEPTED_LOGO_TYPES", () => {
  it("includes PNG, JPEG, SVG, WebP", () => {
    expect(ACCEPTED_LOGO_TYPES).toContain("image/png");
    expect(ACCEPTED_LOGO_TYPES).toContain("image/jpeg");
    expect(ACCEPTED_LOGO_TYPES).toContain("image/svg+xml");
    expect(ACCEPTED_LOGO_TYPES).toContain("image/webp");
    expect(ACCEPTED_LOGO_TYPES).toHaveLength(4);
  });
});

import { describe, it, expect } from "vitest";
import { submitUrlSchema, extensionLoginSchema } from "@api/lib/validate.js";

describe("extension schemas", () => {
  describe("submitUrlSchema", () => {
    it("test_REQ_007_submit_schema_rejects_bad_input: rejects non-URL string", () => {
      const result = submitUrlSchema.safeParse({ url: "not-a-url" });
      expect(result.success).toBe(false);
    });

    it("test_REQ_007_submit_schema_rejects_bad_input: rejects title over 200 chars", () => {
      const result = submitUrlSchema.safeParse({
        url: "https://example.com",
        title: "x".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid URL without title", () => {
      const result = submitUrlSchema.safeParse({ url: "https://example.com/article" });
      expect(result.success).toBe(true);
    });

    it("accepts valid URL with title within 200 chars", () => {
      const result = submitUrlSchema.safeParse({
        url: "https://example.com",
        title: "A valid title",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty object", () => {
      const result = submitUrlSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("extensionLoginSchema", () => {
    it("accepts non-empty password", () => {
      const result = extensionLoginSchema.safeParse({ password: "secret" });
      expect(result.success).toBe(true);
    });

    it("rejects empty password", () => {
      const result = extensionLoginSchema.safeParse({ password: "" });
      expect(result.success).toBe(false);
    });

    it("rejects missing password", () => {
      const result = extensionLoginSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

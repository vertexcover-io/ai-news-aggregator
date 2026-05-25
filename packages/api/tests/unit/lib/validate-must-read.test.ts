import { describe, it, expect } from "vitest";
import {
  previewSchema,
  createSchema,
  patchSchema,
} from "@api/lib/validate-must-read.js";

describe("previewSchema", () => {
  it("accepts a valid URL", () => {
    const result = previewSchema.safeParse({ url: "https://example.com/article" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL string", () => {
    const result = previewSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects missing url field", () => {
    const result = previewSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("createSchema", () => {
  const valid = {
    url: "https://example.com/paper",
    title: "A Great Paper",
    author: "Jane Doe",
    year: 2023,
    annotation: "This is a great read.",
  };

  it("accepts a fully valid object", () => {
    const result = createSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts null author", () => {
    const result = createSchema.safeParse({ ...valid, author: null });
    expect(result.success).toBe(true);
  });

  it("accepts null year", () => {
    const result = createSchema.safeParse({ ...valid, year: null });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL string for url", () => {
    const result = createSchema.safeParse({ ...valid, url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects title exceeding 500 chars", () => {
    const result = createSchema.safeParse({ ...valid, title: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = createSchema.safeParse({ ...valid, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects author exceeding 200 chars", () => {
    const result = createSchema.safeParse({ ...valid, author: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects empty author string", () => {
    const result = createSchema.safeParse({ ...valid, author: "" });
    expect(result.success).toBe(false);
  });

  it("rejects year below 1900", () => {
    const result = createSchema.safeParse({ ...valid, year: 1899 });
    expect(result.success).toBe(false);
  });

  it("rejects year above 2100", () => {
    const result = createSchema.safeParse({ ...valid, year: 2101 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer year", () => {
    const result = createSchema.safeParse({ ...valid, year: 2023.5 });
    expect(result.success).toBe(false);
  });

  it("accepts year at boundary 1900", () => {
    const result = createSchema.safeParse({ ...valid, year: 1900 });
    expect(result.success).toBe(true);
  });

  it("accepts year at boundary 2100", () => {
    const result = createSchema.safeParse({ ...valid, year: 2100 });
    expect(result.success).toBe(true);
  });

  it("rejects annotation exceeding 5000 chars", () => {
    const result = createSchema.safeParse({ ...valid, annotation: "a".repeat(5001) });
    expect(result.success).toBe(false);
  });

  it("rejects empty annotation", () => {
    const result = createSchema.safeParse({ ...valid, annotation: "" });
    expect(result.success).toBe(false);
  });
});

describe("patchSchema", () => {
  it("accepts a single field (url only)", () => {
    const result = patchSchema.safeParse({ url: "https://example.com/updated" });
    expect(result.success).toBe(true);
  });

  it("accepts a single field (title only)", () => {
    const result = patchSchema.safeParse({ title: "Updated Title" });
    expect(result.success).toBe(true);
  });

  it("accepts a single field (author only)", () => {
    const result = patchSchema.safeParse({ author: "New Author" });
    expect(result.success).toBe(true);
  });

  it("accepts a single field (year only)", () => {
    const result = patchSchema.safeParse({ year: 2024 });
    expect(result.success).toBe(true);
  });

  it("accepts a single field (annotation only)", () => {
    const result = patchSchema.safeParse({ annotation: "Updated annotation text." });
    expect(result.success).toBe(true);
  });

  it("accepts multiple fields", () => {
    const result = patchSchema.safeParse({ title: "New Title", year: 2022 });
    expect(result.success).toBe(true);
  });

  it("rejects an empty object (no fields present)", () => {
    const result = patchSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "at least one field is required")).toBe(
        true,
      );
    }
  });

  it("rejects title exceeding 500 chars", () => {
    const result = patchSchema.safeParse({ title: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects url that is not a valid URL", () => {
    const result = patchSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("accepts null author in patch", () => {
    const result = patchSchema.safeParse({ author: null });
    expect(result.success).toBe(true);
  });

  it("accepts null year in patch", () => {
    const result = patchSchema.safeParse({ year: null });
    expect(result.success).toBe(true);
  });
});

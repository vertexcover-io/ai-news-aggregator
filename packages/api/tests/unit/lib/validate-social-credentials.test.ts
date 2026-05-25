import { describe, it, expect } from "vitest";
import {
  linkedinUpsertSchema,
  twitterUpsertSchema,
  twitterCollectorUpsertSchema,
} from "@api/lib/validate-social-credentials.js";

describe("linkedinUpsertSchema", () => {
  it("accepts valid clientId, clientSecret, and optional apiVersion", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "client-id-123",
      clientSecret: "secret-456",
      apiVersion: "202504",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid clientId and clientSecret without apiVersion", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "client-id-123",
      clientSecret: "secret-456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing clientId", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientSecret: "secret-456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing clientSecret", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "client-id-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty clientId", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "",
      clientSecret: "secret-456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty clientSecret", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "client-id-123",
      clientSecret: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only clientId", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "   ",
      clientSecret: "secret-456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiVersion when provided", () => {
    const result = linkedinUpsertSchema.safeParse({
      clientId: "client-id-123",
      clientSecret: "secret-456",
      apiVersion: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("twitterUpsertSchema", () => {
  const valid = {
    apiKey: "api-key-abc",
    apiSecret: "api-secret-def",
    accessToken: "access-token-ghi",
    accessTokenSecret: "access-token-secret-jkl",
  };

  it("accepts all four required fields", () => {
    const result = twitterUpsertSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const { apiKey: _, ...rest } = valid;
    const result = twitterUpsertSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing apiSecret", () => {
    const { apiSecret: _, ...rest } = valid;
    const result = twitterUpsertSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing accessToken", () => {
    const { accessToken: _, ...rest } = valid;
    const result = twitterUpsertSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing accessTokenSecret", () => {
    const { accessTokenSecret: _, ...rest } = valid;
    const result = twitterUpsertSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = twitterUpsertSchema.safeParse({ ...valid, apiKey: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only accessToken", () => {
    const result = twitterUpsertSchema.safeParse({ ...valid, accessToken: "  " });
    expect(result.success).toBe(false);
  });
});

describe("twitterCollectorUpsertSchema", () => {
  it("accepts a valid apiKey", () => {
    const result = twitterCollectorUpsertSchema.safeParse({ apiKey: "rettiwt-key-xyz" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = twitterCollectorUpsertSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = twitterCollectorUpsertSchema.safeParse({ apiKey: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only apiKey", () => {
    const result = twitterCollectorUpsertSchema.safeParse({ apiKey: "   " });
    expect(result.success).toBe(false);
  });
});

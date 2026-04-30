import { describe, it, expect } from "vitest";
import { userSettingsUpsertSchema } from "@api/lib/validate.js";

const baseSettings = {
  topN: 10,
  halfLifeHours: null,
  hnConfig: null,
  redditConfig: null,
  webConfig: null,
  twitterConfig: null,
  scheduleTime: "09:00",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: false,
};

describe("twitterConfig schema — REQ-040..REQ-044, EDGE-011/012", () => {
  describe("REQ-040: twitterConfig field presence", () => {
    it("REQ-040 accepts a valid twitter config object", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: {
          users: ["openai"],
          listIds: ["1234567890"],
          maxPerSource: 50,
          sinceDays: 1,
        },
      });
      expect(r.success).toBe(true);
    });

    it("REQ-040 accepts twitterConfig: null", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: null,
      });
      expect(r.success).toBe(true);
    });

    it("REQ-040 rejects when twitterConfig key is absent (undefined)", () => {
      const payload = { ...baseSettings };
      delete (payload as Record<string, unknown>).twitterConfig;
      const r = userSettingsUpsertSchema.safeParse(payload);
      expect(r.success).toBe(false);
    });
  });

  describe("REQ-041: maxPerSource and sinceDays bounds", () => {
    const validTwitter = {
      users: ["openai"],
      listIds: [],
      maxPerSource: 50,
      sinceDays: 1,
    };

    it("REQ-041 maxPerSource: 0 is rejected", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, maxPerSource: 0 },
      });
      expect(r.success).toBe(false);
    });

    it("REQ-041 maxPerSource: 1 is accepted", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, maxPerSource: 1 },
      });
      expect(r.success).toBe(true);
    });

    it("REQ-041 maxPerSource: 200 is accepted", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, maxPerSource: 200 },
      });
      expect(r.success).toBe(true);
    });

    it("REQ-041 maxPerSource: 201 is rejected", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, maxPerSource: 201 },
      });
      expect(r.success).toBe(false);
    });

    it("REQ-041 sinceDays: 0 is rejected", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, sinceDays: 0 },
      });
      expect(r.success).toBe(false);
    });

    it("REQ-041 sinceDays: 1 is accepted", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, sinceDays: 1 },
      });
      expect(r.success).toBe(true);
    });

    it("REQ-041 sinceDays: 30 is accepted", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, sinceDays: 30 },
      });
      expect(r.success).toBe(true);
    });

    it("REQ-041 sinceDays: 31 is rejected", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: { ...validTwitter, sinceDays: 31 },
      });
      expect(r.success).toBe(false);
    });
  });

  describe("REQ-042: list-input parser", () => {
    const withListId = (listIds: string[]) =>
      userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: {
          users: [],
          listIds,
          maxPerSource: 50,
          sinceDays: 1,
        },
      });

    it("REQ-042 numeric list id passthrough: '1234567890' → '1234567890'", () => {
      const r = withListId(["1234567890"]);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.twitterConfig?.listIds[0]).toBe("1234567890");
      }
    });

    it("REQ-042 x.com URL parse: extracts numeric id", () => {
      const r = withListId(["https://x.com/i/lists/1234567890"]);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.twitterConfig?.listIds[0]).toBe("1234567890");
      }
    });

    it("REQ-042 twitter.com URL parse: extracts numeric id", () => {
      const r = withListId(["https://twitter.com/i/lists/1234567890"]);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.twitterConfig?.listIds[0]).toBe("1234567890");
      }
    });

    it("REQ-042 EDGE-011: handle-prefixed list URL extracts trailing numeric id", () => {
      const r = withListId(["https://twitter.com/jack/lists/tech/9876543210"]);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.twitterConfig?.listIds[0]).toBe("9876543210");
      }
    });
  });

  describe("REQ-043 / EDGE-012: garbage list inputs are rejected", () => {
    const withListId = (listId: string) =>
      userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: {
          users: [],
          listIds: [listId],
          maxPerSource: 50,
          sinceDays: 1,
        },
      });

    it("REQ-043 EDGE-012: rejects 'not-a-url'", () => {
      expect(withListId("not-a-url").success).toBe(false);
    });

    it("REQ-043 EDGE-012: rejects '@123456789' (handle-prefixed, not a URL or plain id)", () => {
      expect(withListId("@123456789").success).toBe(false);
    });

    it("REQ-043 EDGE-012: rejects empty string", () => {
      expect(withListId("").success).toBe(false);
    });
  });

  describe("REQ-044: user handle canonicalization", () => {
    it("REQ-044 trims whitespace, strips leading @, lowercases handle", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: {
          users: ["  @OpenAI "],
          listIds: [],
          maxPerSource: 50,
          sinceDays: 1,
        },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.twitterConfig?.users[0]).toBe("openai");
      }
    });

    it("REQ-044 handle without @ is also lowercased and trimmed", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: {
          users: [" AnthropicAI "],
          listIds: [],
          maxPerSource: 50,
          sinceDays: 1,
        },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.twitterConfig?.users[0]).toBe("anthropicai");
      }
    });
  });

  describe("scheduleEnabled refine with twitter as enabled source", () => {
    it("scheduleEnabled=true with only twitterConfig set is accepted", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: {
          users: ["openai"],
          listIds: [],
          maxPerSource: 50,
          sinceDays: 1,
        },
        scheduleEnabled: true,
      });
      expect(r.success).toBe(true);
    });

    it("scheduleEnabled=true with all sources null (including twitterConfig) is rejected", () => {
      const r = userSettingsUpsertSchema.safeParse({
        ...baseSettings,
        twitterConfig: null,
        scheduleEnabled: true,
      });
      expect(r.success).toBe(false);
    });
  });
});

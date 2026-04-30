import { describe, it, expect } from "vitest";
import { settingsFormSchema } from "../../src/pages/settingsSchema.js";

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

describe("settingsFormSchema twitterConfig — parity with API schema", () => {
  describe("REQ-040: twitterConfig field presence", () => {
    it("REQ-040 accepts a valid twitter config object", () => {
      const r = settingsFormSchema.safeParse({
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
      const r = settingsFormSchema.safeParse({
        ...baseSettings,
        twitterConfig: null,
      });
      expect(r.success).toBe(true);
    });

    it("REQ-040 rejects when twitterConfig key is absent", () => {
      const payload = { ...baseSettings };
      delete (payload as Record<string, unknown>).twitterConfig;
      const r = settingsFormSchema.safeParse(payload);
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
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, maxPerSource: 0 },
        }).success,
      ).toBe(false);
    });

    it("REQ-041 maxPerSource: 1 is accepted", () => {
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, maxPerSource: 1 },
        }).success,
      ).toBe(true);
    });

    it("REQ-041 maxPerSource: 200 is accepted", () => {
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, maxPerSource: 200 },
        }).success,
      ).toBe(true);
    });

    it("REQ-041 maxPerSource: 201 is rejected", () => {
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, maxPerSource: 201 },
        }).success,
      ).toBe(false);
    });

    it("REQ-041 sinceDays: 0 is rejected", () => {
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, sinceDays: 0 },
        }).success,
      ).toBe(false);
    });

    it("REQ-041 sinceDays: 30 is accepted", () => {
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, sinceDays: 30 },
        }).success,
      ).toBe(true);
    });

    it("REQ-041 sinceDays: 31 is rejected", () => {
      expect(
        settingsFormSchema.safeParse({
          ...baseSettings,
          twitterConfig: { ...validTwitter, sinceDays: 31 },
        }).success,
      ).toBe(false);
    });
  });

  describe("REQ-042: list-input parser parity", () => {
    const withListId = (listIds: string[]) =>
      settingsFormSchema.safeParse({
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
      settingsFormSchema.safeParse({
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

    it("REQ-043 EDGE-012: rejects '@123456789'", () => {
      expect(withListId("@123456789").success).toBe(false);
    });

    it("REQ-043 EDGE-012: rejects empty string", () => {
      expect(withListId("").success).toBe(false);
    });
  });

  describe("REQ-044: user handle canonicalization parity", () => {
    it("REQ-044 trims, strips @, lowercases handle", () => {
      const r = settingsFormSchema.safeParse({
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
  });

  describe("scheduleEnabled refine with twitter as enabled source", () => {
    it("scheduleEnabled=true with only twitterConfig set is accepted", () => {
      const r = settingsFormSchema.safeParse({
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

    it("scheduleEnabled=true with all sources null (incl. twitterConfig) is rejected", () => {
      const r = settingsFormSchema.safeParse({
        ...baseSettings,
        twitterConfig: null,
        scheduleEnabled: true,
      });
      expect(r.success).toBe(false);
    });
  });
});

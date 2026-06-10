import { describe, it, expect } from "vitest";
import type {
  TenantNotificationConfig,
  TenantFeatureFlags,
} from "@shared/types/tenant.js";

describe("TenantNotificationConfig", () => {
  it("allows email-only configuration", () => {
    const config: TenantNotificationConfig = {
      notifyEmail: "ops@example.com",
      slackWebhook: null,
    };
    expect(config.notifyEmail).toBe("ops@example.com");
    expect(config.slackWebhook).toBeNull();
  });

  it("allows encrypted webhook-only configuration", () => {
    const config: TenantNotificationConfig = {
      notifyEmail: null,
      slackWebhook: { ct: "abc", iv: "def", tag: "ghi" },
    };
    expect(config.notifyEmail).toBeNull();
    expect(config.slackWebhook).toEqual({ ct: "abc", iv: "def", tag: "ghi" });
  });

  it("allows both email and webhook", () => {
    const config: TenantNotificationConfig = {
      notifyEmail: "ops@example.com",
      slackWebhook: { ct: "abc", iv: "def", tag: "ghi" },
    };
    expect(config.notifyEmail).toBe("ops@example.com");
    expect(config.slackWebhook).not.toBeNull();
  });

  it("allows neither email nor webhook (both null)", () => {
    const config: TenantNotificationConfig = {
      notifyEmail: null,
      slackWebhook: null,
    };
    expect(config.notifyEmail).toBeNull();
    expect(config.slackWebhook).toBeNull();
  });
});

describe("TenantFeatureFlags", () => {
  it("allows all three flags with their correct types", () => {
    const flags: TenantFeatureFlags = {
      canon: true,
      deliverability: false,
      eval: false,
    };
    expect(flags.canon).toBe(true);
    expect(flags.deliverability).toBe(false);
    expect(flags.eval).toBe(false);
  });

  it("allows all flags off", () => {
    const flags: TenantFeatureFlags = {
      canon: false,
      deliverability: false,
      eval: false,
    };
    expect(flags.canon).toBe(false);
    expect(flags.deliverability).toBe(false);
    expect(flags.eval).toBe(false);
  });

  it("flags are independent — canon on does not imply others", () => {
    const flags: TenantFeatureFlags = {
      canon: true,
      deliverability: false,
      eval: false,
    };
    expect(flags.canon).toBe(true);
    expect(flags.deliverability).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type {
  HomePagePayload,
  TenantBranding,
  TenantFlags,
} from "@shared/types/home.js";

describe("TenantBranding", () => {
  it("can be constructed with all required fields", () => {
    const b: TenantBranding = {
      name: "Test",
      headline: null,
      topicStrip: null,
      subtagline: null,
      logoUrl: null,
      flags: { canon: false, isTenantZero: false },
    };
    expect(b.name).toBe("Test");
    expect(b.flags.canon).toBe(false);
    expect(b.flags.isTenantZero).toBe(false);
  });

  it("can represent AGENTLOOP branding", () => {
    const b: TenantBranding = {
      name: "AGENTLOOP",
      headline: "The daily read for people who ship with agents.",
      topicStrip:
        "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
      subtagline: "No model releases. No benchmarks. No discourse. Just the craft.",
      logoUrl: null,
      flags: { canon: true, isTenantZero: true },
    };
    expect(b.name).toBe("AGENTLOOP");
    expect(b.flags.canon).toBe(true);
    expect(b.flags.isTenantZero).toBe(true);
  });
});

describe("HomePagePayload", () => {
  it("includes branding alongside todaysIssue, featuredCanon, recentIssues", () => {
    const p: HomePagePayload = {
      branding: {
        name: "T",
        headline: null,
        topicStrip: null,
        subtagline: null,
        logoUrl: null,
        flags: { canon: false, isTenantZero: false },
      },
      todaysIssue: null,
      featuredCanon: null,
      recentIssues: [],
    };
    expect(p.branding.name).toBe("T");
    expect(p.todaysIssue).toBeNull();
  });
});

describe("TenantFlags", () => {
  it("defaults for a new tenant (not AGENTLOOP)", () => {
    const f: TenantFlags = { canon: false, isTenantZero: false };
    expect(f.canon).toBe(false);
    expect(f.isTenantZero).toBe(false);
  });
});

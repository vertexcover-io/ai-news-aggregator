import { describe, expect, it } from "vitest";
import {
  selectImmediatePublishChannels,
  type ImmediatePublishSettings,
} from "@shared/scheduling/immediate-publish.js";
import { publishDateForWindow } from "@shared/scheduling/tz.js";

// Baseline settings used across tests — all channels enabled, NY timezone
const BASE_SETTINGS: ImmediatePublishSettings = {
  scheduleEnabled: true,
  scheduleTimezone: "America/New_York",
  pipelineTime: "03:00",
  emailEnabled: true,
  emailTime: "06:00",
  linkedinEnabled: true,
  linkedinTime: "09:00",
  twitterPostEnabled: true,
  twitterTime: "10:00",
};

// completedAt: 2026-05-26 03:30 UTC = 2026-05-25 23:30 NY (pipeline just ran at ~03:00 NY)
const COMPLETED_AT = new Date("2026-05-26T07:30:00.000Z");

// Helper: compute the scheduled moment for a channel using publishDateForWindow directly
function scheduledMomentFor(settings: ImmediatePublishSettings, channelTime: string): Date {
  return publishDateForWindow({
    timezone: settings.scheduleTimezone,
    pipelineTime: settings.pipelineTime,
    publishTime: channelTime,
    completedAt: COMPLETED_AT,
  });
}

describe("selectImmediatePublishChannels", () => {
  // EDGE-008: all channels enabled + all past-due → returns all three
  it("returns all three channels when all enabled and all past-due", () => {
    const emailMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.emailTime);
    const linkedinMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.linkedinTime);
    const twitterMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.twitterTime);

    // now is after all three moments
    const latestMoment = new Date(
      Math.max(emailMoment.getTime(), linkedinMoment.getTime(), twitterMoment.getTime()),
    );
    const now = new Date(latestMoment.getTime() + 60_000); // 1 min after the latest

    const result = selectImmediatePublishChannels({
      settings: BASE_SETTINGS,
      completedAt: COMPLETED_AT,
      now,
    });

    expect(result).toHaveLength(3);
    expect(result).toContain("email-send");
    expect(result).toContain("linkedin-post");
    expect(result).toContain("twitter-post");
  });

  // REQ-004, EDGE-009: scheduleEnabled=false → always []
  it("returns [] when scheduleEnabled is false regardless of channel state", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      scheduleEnabled: false,
    };
    // now is far in the future — would normally trigger all channels
    const now = new Date(COMPLETED_AT.getTime() + 24 * 60 * 60 * 1000);

    const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });

    expect(result).toEqual([]);
  });

  // REQ-004, EDGE-010: one channel disabled → omitted, others kept
  it("omits a disabled channel and keeps the enabled past-due ones", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      linkedinEnabled: false,
    };

    const twitterMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.twitterTime);
    const now = new Date(twitterMoment.getTime() + 60_000);

    const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });

    expect(result).not.toContain("linkedin-post");
    expect(result).toContain("email-send");
    expect(result).toContain("twitter-post");
  });

  // REQ-003 helper-side, EDGE-007: future channel omitted, past-due sibling kept
  it("omits a future channel and keeps a past-due sibling", () => {
    const emailMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.emailTime);
    // now is after email but before linkedin and twitter
    const now = new Date(emailMoment.getTime() + 60_000);

    const result = selectImmediatePublishChannels({
      settings: BASE_SETTINGS,
      completedAt: COMPLETED_AT,
      now,
    });

    expect(result).toContain("email-send");
    expect(result).not.toContain("linkedin-post");
    expect(result).not.toContain("twitter-post");
  });

  // EDGE-005: strict boundary — now === scheduledMoment → NOT included
  it("does not include a channel when now equals the scheduled moment exactly", () => {
    const emailMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.emailTime);
    // now exactly equals the email scheduled moment
    const now = new Date(emailMoment.getTime());

    const result = selectImmediatePublishChannels({
      settings: BASE_SETTINGS,
      completedAt: COMPLETED_AT,
      now,
    });

    expect(result).not.toContain("email-send");
  });

  // REQ-006, EDGE-001: malformed channelTime → channel omitted, no throw
  it("omits a channel with a malformed channelTime without throwing", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      emailTime: "24:00", // invalid hour
    };

    const twitterMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.twitterTime);
    const now = new Date(twitterMoment.getTime() + 60_000);

    expect(() => {
      const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });
      expect(result).not.toContain("email-send");
      // other valid channels are still evaluated
      expect(result).toContain("linkedin-post");
      expect(result).toContain("twitter-post");
    }).not.toThrow();
  });

  // REQ-006, EDGE-001: empty string channelTime → channel omitted, no throw
  it("omits a channel with an empty channelTime without throwing", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      linkedinTime: "",
    };

    const twitterMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.twitterTime);
    const now = new Date(twitterMoment.getTime() + 60_000);

    expect(() => {
      const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });
      expect(result).not.toContain("linkedin-post");
      expect(result).toContain("email-send");
      expect(result).toContain("twitter-post");
    }).not.toThrow();
  });

  // REQ-006, EDGE-001: "9:5" (non-padded) → channel omitted, no throw
  it("omits a channel with a non-padded malformed channelTime without throwing", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      twitterTime: "9:5",
    };

    const linkedinMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.linkedinTime);
    const now = new Date(linkedinMoment.getTime() + 60_000);

    expect(() => {
      const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });
      expect(result).not.toContain("twitter-post");
      expect(result).toContain("email-send");
      expect(result).toContain("linkedin-post");
    }).not.toThrow();
  });

  // REQ-006, EDGE-002: channelTime === pipelineTime → window throws by contract → channel omitted, others kept, no throw
  it("omits a channel whose channelTime equals pipelineTime without throwing", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      emailTime: BASE_SETTINGS.pipelineTime, // "03:00" === pipelineTime
    };

    const twitterMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.twitterTime);
    const now = new Date(twitterMoment.getTime() + 60_000);

    expect(() => {
      const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });
      expect(result).not.toContain("email-send");
      expect(result).toContain("linkedin-post");
      expect(result).toContain("twitter-post");
    }).not.toThrow();
  });

  // EDGE-011: day-rollover — channelTime < pipelineTime → scheduled moment is next-day occurrence
  it("correctly handles day-rollover when channelTime is before pipelineTime", () => {
    // pipelineTime = 23:00, emailTime = 06:00 (next day)
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      pipelineTime: "23:00",
      emailTime: "06:00",
      linkedinEnabled: false,
      twitterPostEnabled: false,
    };
    // completedAt in NY = just after 23:00 run
    const completedAt = new Date("2026-05-26T03:30:00.000Z"); // 2026-05-25 23:30 NY

    const scheduled: Date = publishDateForWindow({
      timezone: settings.scheduleTimezone,
      pipelineTime: settings.pipelineTime,
      publishTime: settings.emailTime,
      completedAt,
    });

    // now before scheduled → not included
    const nowBefore = new Date(scheduled.getTime() - 60_000);
    const resultBefore = selectImmediatePublishChannels({ settings, completedAt, now: nowBefore });
    expect(resultBefore).not.toContain("email-send");

    // now after scheduled → included
    const nowAfter = new Date(scheduled.getTime() + 60_000);
    const resultAfter = selectImmediatePublishChannels({ settings, completedAt, now: nowAfter });
    expect(resultAfter).toContain("email-send");
  });

  // VS-3: cross-check — past-due decision matches direct publishDateForWindow comparison
  it("VS-3: past-due decision matches direct publishDateForWindow for each channel", () => {
    const emailMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.emailTime);
    const linkedinMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.linkedinTime);
    const twitterMoment = scheduledMomentFor(BASE_SETTINGS, BASE_SETTINGS.twitterTime);

    // Test at 5 distinct points in time across the window
    const testPoints = [
      new Date(emailMoment.getTime() - 1), // before email
      new Date(emailMoment.getTime() + 1), // just after email
      new Date(linkedinMoment.getTime() + 1), // just after linkedin
      new Date(twitterMoment.getTime() + 1), // just after twitter
      new Date(twitterMoment.getTime() + 3_600_000), // 1hr after all
    ];

    for (const now of testPoints) {
      const result = selectImmediatePublishChannels({
        settings: BASE_SETTINGS,
        completedAt: COMPLETED_AT,
        now,
      });

      const emailExpected = now.getTime() > emailMoment.getTime();
      const linkedinExpected = now.getTime() > linkedinMoment.getTime();
      const twitterExpected = now.getTime() > twitterMoment.getTime();

      expect(result.includes("email-send")).toBe(emailExpected);
      expect(result.includes("linkedin-post")).toBe(linkedinExpected);
      expect(result.includes("twitter-post")).toBe(twitterExpected);
    }
  });

  // all disabled → [] even with scheduleEnabled=true
  it("returns [] when all channels are disabled individually", () => {
    const settings: ImmediatePublishSettings = {
      ...BASE_SETTINGS,
      emailEnabled: false,
      linkedinEnabled: false,
      twitterPostEnabled: false,
    };
    const now = new Date(COMPLETED_AT.getTime() + 24 * 60 * 60 * 1000);

    const result = selectImmediatePublishChannels({ settings, completedAt: COMPLETED_AT, now });
    expect(result).toEqual([]);
  });

  // now far in the past → [] (nothing past-due yet)
  it("returns [] when now is before all scheduled moments", () => {
    // now is right at completedAt — before any channel fires
    const now = new Date(COMPLETED_AT.getTime());

    const result = selectImmediatePublishChannels({
      settings: BASE_SETTINGS,
      completedAt: COMPLETED_AT,
      now,
    });

    expect(result).toEqual([]);
  });
});

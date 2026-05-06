import { describe, it, expect } from "vitest";
import {
  settingsFormSchema,
  normalizeSettingsForSubmit,
} from "../../../src/pages/settingsSchema";

// VS-6 regression: the UI form silently no-ops on Save for Twitter changes.
// The bug surfaced when an operator toggled Twitter on, added a list and a
// user, and clicked Save. handleSubmit's inner callback never fired —
// classic sign that zod validation rejected and RHF swallowed the error.
// These tests reproduce the EXACT form state at submit time and assert
// the schema accepts it.

describe("settingsFormSchema — VS-6 regression", () => {
  const baseValid = {
    topN: 12,
    halfLifeHours: 24,
    hnConfig: {
      keywords: ["ai", "llm", "agents"],
      pointsThreshold: 100,
      sinceDays: 1,
      count: 50,
      feeds: ["newest", "best"],
      commentsPerItem: 10,
    },
    redditConfig: {
      subreddits: ["MachineLearning", "LocalLLaMA"],
      sort: "hot" as const,
      limit: 25,
      sinceDays: 1,
    },
    webConfig: null,
    scheduleTime: "07:00",
    scheduleTimezone: "Asia/Calcutta",
    scheduleEnabled: false,
  };

  it("VS-6: parses Twitter form state with one list + one handle (no userId)", () => {
    const formState = {
      ...baseValid,
      twitterConfig: {
        listIds: [{ value: "1585430245762441216" }],
        users: [{ handle: "sama" }], // userId not set — operator just typed the handle
        maxTweetsPerSource: 50,
        sinceHours: 24,
      },
    };

    const result = settingsFormSchema.safeParse(formState);
    if (!result.success) {
      // surface the issues so the failure message is actionable
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("VS-6: parses Twitter form state where useFieldArray adds a default `userId: ''`", () => {
    // useFieldArray's `append({ handle: "", userId: "" })` shape — see
    // SourcesSection.tsx where the Add user button is wired.
    const formState = {
      ...baseValid,
      twitterConfig: {
        listIds: [{ value: "1585430245762441216" }],
        users: [{ handle: "sama", userId: "" }],
        maxTweetsPerSource: 50,
        sinceHours: 24,
      },
    };
    const result = settingsFormSchema.safeParse(formState);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("VS-6: parses fully-populated Twitter form state (all defaults from DEFAULT_TWITTER)", () => {
    const formState = {
      ...baseValid,
      twitterConfig: {
        listIds: [],
        users: [],
        maxTweetsPerSource: 50,
        sinceHours: 24,
      },
    };
    const result = settingsFormSchema.safeParse(formState);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("VS-6: normalizeSettingsForSubmit produces the API shape for the form state", () => {
    const formState = {
      ...baseValid,
      twitterConfig: {
        listIds: [{ value: "1585430245762441216" }],
        users: [{ handle: "sama", userId: "" }],
        maxTweetsPerSource: 50,
        sinceHours: 24,
      },
    };
    const parsed = settingsFormSchema.safeParse(formState);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const submitted = normalizeSettingsForSubmit(parsed.data);
    expect(submitted.twitterConfig).toEqual({
      listIds: ["1585430245762441216"],
      users: [{ handle: "sama" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    });
  });
});

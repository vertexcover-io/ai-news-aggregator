import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import { getSettings, putSettings } from "../../../src/api/settings";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sample: UserSettings = {
  id: "00000000-0000-0000-0000-000000000001",
  topN: 12,
  halfLifeHours: 24,
  hnEnabled: false,
  hnConfig: null,
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  webSearchEnabled: false,
  webSearchConfig: null,
  posthogEnabled: false,
  posthogProjectToken: null,
  posthogHost: null,
  scheduleTime: "07:00",
  pipelineTime: "07:00",
  emailTime: "07:30",
  linkedinTime: "07:45",
  twitterTime: "08:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
  rankingPrompt: "test-prompt",
  shortlistPrompt: "test-shortlist-prompt",
  shortlistSize: 30,
  updatedAt: "2026-04-14T00:00:00Z",
};

describe("settings api", () => {
  it("getSettings returns row", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sample), { status: 200 }),
    );
    const out = await getSettings();
    expect(out).toEqual(sample);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({}),
    );
  });

  it("getSettings returns null when API returns null", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("null", { status: 200 }),
    );
    const out = await getSettings();
    expect(out).toBeNull();
  });

  it("getSettings throws on non-OK", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(getSettings()).rejects.toThrow("Failed to fetch settings");
  });

  it("putSettings PUTs body and returns saved", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sample), { status: 200 }),
    );
    const input = {
      topN: sample.topN,
      halfLifeHours: sample.halfLifeHours,
      hnEnabled: sample.hnEnabled,
      hnConfig: sample.hnConfig,
      redditEnabled: sample.redditEnabled,
      redditConfig: sample.redditConfig,
      webEnabled: sample.webEnabled,
      webConfig: sample.webConfig,
      twitterEnabled: sample.twitterEnabled,
      twitterConfig: sample.twitterConfig,
      webSearchEnabled: sample.webSearchEnabled,
      webSearchConfig: sample.webSearchConfig,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      pipelineTime: sample.pipelineTime,
      emailTime: sample.emailTime,
      linkedinTime: sample.linkedinTime,
      twitterTime: sample.twitterTime,
      scheduleTimezone: sample.scheduleTimezone,
      scheduleEnabled: sample.scheduleEnabled,
      emailEnabled: sample.emailEnabled,
      linkedinEnabled: sample.linkedinEnabled,
      twitterPostEnabled: sample.twitterPostEnabled,
      autoReview: sample.autoReview,
      rankingPrompt: sample.rankingPrompt,
      shortlistPrompt: sample.shortlistPrompt,
      shortlistSize: sample.shortlistSize,
    };
    const out = await putSettings(input);
    expect(out).toEqual(sample);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("putSettings throws with server error message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad input" }), { status: 400 }),
    );
    await expect(
      putSettings({
        topN: 10,
        halfLifeHours: null,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
        webSearchEnabled: false,
        webSearchConfig: null,
        posthogEnabled: false,
        posthogProjectToken: null,
        posthogHost: null,
        pipelineTime: "07:00",
        emailTime: "07:30",
        linkedinTime: "07:45",
        twitterTime: "08:00",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
        emailEnabled: true,
        linkedinEnabled: true,
        twitterPostEnabled: true,
        autoReview: false,
        rankingPrompt: "test prompt",
        shortlistPrompt: "test shortlist prompt",
        shortlistSize: 30,
      }),
    ).rejects.toThrow("bad input");
  });
});

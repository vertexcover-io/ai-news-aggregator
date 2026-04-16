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
  hnConfig: null,
  redditConfig: null,
  webConfig: null,
  scheduleTime: "07:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
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
      hnConfig: sample.hnConfig,
      redditConfig: sample.redditConfig,
      webConfig: sample.webConfig,
      scheduleTime: sample.scheduleTime,
      scheduleTimezone: sample.scheduleTimezone,
      scheduleEnabled: sample.scheduleEnabled,
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
        hnConfig: null,
        redditConfig: null,
        webConfig: null,
        scheduleTime: "07:00",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
      }),
    ).rejects.toThrow("bad input");
  });
});

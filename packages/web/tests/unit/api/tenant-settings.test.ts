import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTenantSettings,
  patchTenantSettings,
} from "../../../src/api/tenant-settings";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tenant-settings client", () => {
  it("getTenantSettings GETs and returns the row", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "t1", slackWebhookConfigured: true }), {
        status: 200,
      }),
    );
    const out = await getTenantSettings();
    expect(out.slackWebhookConfigured).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/tenant-settings");
  });

  it("patchTenantSettings PATCHes the partial body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "t1", headline: "New" }), { status: 200 }),
    );
    await patchTenantSettings({ headline: "New", slackWebhook: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tenant-settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      headline: "New",
      slackWebhook: null,
    });
  });

  it("throws server error message on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 }),
    );
    await expect(patchTenantSettings({ name: "x" })).rejects.toThrow("invalid_body");
  });
});

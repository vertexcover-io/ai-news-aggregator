import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSlug,
  discoverSources,
  generatePrompts,
  activate,
  ActivationIncompleteError,
} from "../../../src/api/onboarding";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkSlug", () => {
  it("encodes slug and returns status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "available" }), { status: 200 }),
    );
    const status = await checkSlug("my slug");
    expect(status).toBe("available");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/onboarding/slug-check?slug=my%20slug");
  });
});

describe("generatePrompts", () => {
  it("POSTs blurb and returns prompts", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ rankingPrompt: "r", shortlistPrompt: "s" }),
        { status: 200 },
      ),
    );
    const out = await generatePrompts("about us");
    expect(out).toEqual({ rankingPrompt: "r", shortlistPrompt: "s" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/onboarding/generate-prompts");
    expect(JSON.parse(init.body as string)).toEqual({ blurb: "about us" });
  });
});

describe("discoverSources", () => {
  it("unwraps candidates array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ type: "hn", name: "HN", config: {} }],
        }),
        { status: 200 },
      ),
    );
    const out = await discoverSources("hn");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("HN");
  });
});

describe("activate", () => {
  it("throws ActivationIncompleteError with missing on 422", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "incomplete", missing: ["slug", "sources"] }), {
        status: 422,
      }),
    );
    const err = await activate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActivationIncompleteError);
    expect((err as ActivationIncompleteError).missing).toEqual(["slug", "sources"]);
  });

  it("returns status on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, status: "active" }), {
        status: 200,
      }),
    );
    const out = await activate();
    expect(out.status).toBe("active");
  });
});

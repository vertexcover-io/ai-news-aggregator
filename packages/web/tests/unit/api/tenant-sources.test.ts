import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSources,
  addSource,
  setSourceEnabled,
  removeSource,
  discover,
} from "../../../src/api/tenant-sources";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tenant-sources client", () => {
  it("listSources GETs the collection", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await listSources();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/tenant-sources");
  });

  it("addSource POSTs the body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "s1" }), { status: 201 }),
    );
    await addSource({ type: "hn", config: { feeds: ["best"] } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tenant-sources");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "hn",
      config: { feeds: ["best"] },
    });
  });

  it("setSourceEnabled PATCHes :id with enabled flag", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "s1", enabled: false }), { status: 200 }),
    );
    await setSourceEnabled("s1", false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tenant-sources/s1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
  });

  it("removeSource DELETEs :id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await removeSource("s1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tenant-sources/s1");
    expect(init.method).toBe("DELETE");
  });

  it("discover passes query and type, unwraps candidates", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ type: "rss", title: "T", url: "u" }] }),
        { status: 200 },
      ),
    );
    const out = await discover("ai news", "rss");
    expect(out).toEqual([{ type: "rss", title: "T", url: "u" }]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("query=ai+news");
    expect(url).toContain("type=rss");
  });
});

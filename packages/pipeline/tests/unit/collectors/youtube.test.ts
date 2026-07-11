import { describe, it, expect, vi } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { YoutubeCollectConfig } from "@pipeline/types.js";
import {
  parseYoutubeFeedXml,
  extractChannelIdFromRef,
  extractChannelIdFromHtml,
  resolveChannelId,
  fetchVideoTranscript,
  buildYoutubeRawItem,
  collectYoutube,
  parseYoutubeVideoIdFromUrl,
  fetchYoutubePost,
  type YoutubeFeedEntry,
  type TranscriptSegment,
} from "@pipeline/collectors/youtube.js";

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

function makeRepo(existing: string[] = []): RawItemsRepo & {
  upsertItems: ReturnType<typeof vi.fn>;
} {
  return {
    upsertItems: vi.fn().mockResolvedValue(undefined),
    findExistingExternalIds: vi.fn().mockResolvedValue(new Set(existing)),
    findBySourceAndExternalId: vi.fn().mockResolvedValue(null),
    findByIds: vi.fn().mockResolvedValue([]),
    updateRecapData: vi.fn().mockResolvedValue(undefined),
  };
}

function feedXml(entries: { videoId: string; title: string; published: string; views?: number }[]): string {
  const entryXml = entries
    .map(
      (e) => `
  <entry>
    <id>yt:video:${e.videoId}</id>
    <yt:videoId>${e.videoId}</yt:videoId>
    <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
    <title>${e.title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${e.videoId}"/>
    <published>${e.published}</published>
    <updated>${e.published}</updated>
    <media:group>
      <media:title>${e.title}</media:title>
      <media:community>
        <media:statistics views="${String(e.views ?? 0)}"/>
      </media:community>
    </media:group>
  </entry>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Test Channel</title>
  <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>${entryXml}
</feed>`;
}

function jsonResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body) as unknown),
  } as unknown as Response;
}

describe("parseYoutubeFeedXml", () => {
  it("parses entries with title, videoId, publishedAt, and view count", () => {
    const xml = feedXml([
      { videoId: "abc12345678", title: "AI news roundup", published: "2026-07-07T16:33:29+00:00", views: 12345 },
    ]);
    const entries = parseYoutubeFeedXml(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].videoId).toBe("abc12345678");
    expect(entries[0].title).toBe("AI news roundup");
    expect(entries[0].publishedAt?.toISOString()).toBe(new Date("2026-07-07T16:33:29+00:00").toISOString());
    expect(entries[0].viewCount).toBe(12345);
    expect(entries[0].channelTitle).toBe("Test Channel");
  });

  it("handles a single-entry feed (fast-xml-parser collapses arrays of length 1)", () => {
    const xml = feedXml([{ videoId: "single1234x", title: "Solo video", published: "2026-01-01T00:00:00+00:00" }]);
    const entries = parseYoutubeFeedXml(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].videoId).toBe("single1234x");
  });

  it("returns an empty array for malformed XML", () => {
    expect(parseYoutubeFeedXml("not xml at all {{{")).toEqual([]);
  });

  it("returns an empty array when there is no <feed> element", () => {
    expect(parseYoutubeFeedXml("<root><foo>bar</foo></root>")).toEqual([]);
  });

  it("skips entries missing a videoId or title", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>Ch</title>
  <entry><yt:videoId>hasidnottl</yt:videoId></entry>
  <entry><title>No id here</title></entry>
</feed>`;
    expect(parseYoutubeFeedXml(xml)).toEqual([]);
  });
});

describe("extractChannelIdFromRef", () => {
  it("accepts a bare channel id", () => {
    expect(extractChannelIdFromRef("UCbfYPyITQ-7l4upoX8nvctg")).toBe("UCbfYPyITQ-7l4upoX8nvctg");
  });

  it("extracts the id from a /channel/ URL", () => {
    expect(
      extractChannelIdFromRef("https://www.youtube.com/channel/UCbfYPyITQ-7l4upoX8nvctg/videos"),
    ).toBe("UCbfYPyITQ-7l4upoX8nvctg");
  });

  it("returns null for a handle (needs network resolution)", () => {
    expect(extractChannelIdFromRef("@lexfridman")).toBeNull();
  });
});

describe("extractChannelIdFromHtml", () => {
  it("extracts from the canonical <link> tag", () => {
    const html = '<link rel="canonical" href="https://www.youtube.com/channel/UCSHZKyawb77ixDdsGog4iWA">';
    expect(extractChannelIdFromHtml(html)).toBe("UCSHZKyawb77ixDdsGog4iWA");
  });

  it("falls back to the externalId field", () => {
    const html = '"externalId":"UCSHZKyawb77ixDdsGog4iWA","otherField":1';
    expect(extractChannelIdFromHtml(html)).toBe("UCSHZKyawb77ixDdsGog4iWA");
  });

  it("returns null when no channel id is present", () => {
    expect(extractChannelIdFromHtml("<html><body>nothing here</body></html>")).toBeNull();
  });
});

describe("resolveChannelId", () => {
  it("resolves a direct id without any network call", async () => {
    const fetchFn = vi.fn();
    const id = await resolveChannelId("UCbfYPyITQ-7l4upoX8nvctg", fetchFn);
    expect(id).toBe("UCbfYPyITQ-7l4upoX8nvctg");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("resolves a @handle via a page fetch", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse('<link rel="canonical" href="https://www.youtube.com/channel/UCSHZKyawb77ixDdsGog4iWA">'));
    const id = await resolveChannelId("@lexfridman", fetchFn);
    expect(id).toBe("UCSHZKyawb77ixDdsGog4iWA");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://www.youtube.com/@lexfridman",
      expect.objectContaining({ headers: expect.any(Object) as unknown }),
    );
  });

  it("throws when the page fetch fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse("", false, 404));
    await expect(resolveChannelId("@doesnotexist", fetchFn)).rejects.toThrow(/HTTP 404/);
  });

  it("throws when the page has no extractable channel id", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse("<html>nothing</html>"));
    await expect(resolveChannelId("@nofingerprint", fetchFn)).rejects.toThrow(/could not resolve/);
  });
});

describe("fetchVideoTranscript", () => {
  it("joins transcript segments into a single string", async () => {
    const segments: TranscriptSegment[] = [
      { text: "Hello ", duration: 1, offset: 0 },
      { text: "world.", duration: 1, offset: 1 },
    ];
    const fn = vi.fn().mockResolvedValue(segments);
    const text = await fetchVideoTranscript("abc", fn);
    expect(text).toBe("Hello world.");
  });

  it("returns null and never throws when the transcript fetch fails", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Transcript is disabled"));
    const text = await fetchVideoTranscript("abc", fn);
    expect(text).toBeNull();
  });

  it("returns null for an empty segment list", async () => {
    const fn = vi.fn().mockResolvedValue([]);
    expect(await fetchVideoTranscript("abc", fn)).toBeNull();
  });

  it("truncates very long transcripts to the storage ceiling", async () => {
    const longText = "word ".repeat(10_000);
    const fn = vi.fn().mockResolvedValue([{ text: longText, duration: 1, offset: 0 }] as TranscriptSegment[]);
    const text = await fetchVideoTranscript("abc", fn);
    expect(text).not.toBeNull();
    expect(text?.length).toBeLessThan(longText.length);
    expect(text?.endsWith("…")).toBe(true);
  });
});

describe("buildYoutubeRawItem", () => {
  it("builds a RawItemInsert matching the shape of other collectors", () => {
    const entry: YoutubeFeedEntry = {
      videoId: "abc12345678",
      title: "AI news roundup",
      publishedAt: new Date("2026-07-07T00:00:00Z"),
      channelTitle: "Some Channel",
      viewCount: 500,
    };
    const item = buildYoutubeRawItem(entry, { name: "Some Channel", channelRef: "@somechannel" }, "UCabc", "the transcript text");
    expect(item.sourceType).toBe("youtube");
    expect(item.externalId).toBe("abc12345678");
    expect(item.url).toBe("https://www.youtube.com/watch?v=abc12345678");
    expect(item.sourceUrl).toBe(item.url);
    expect(item.content).toBe("the transcript text");
    expect(item.engagement).toEqual({ points: 500, commentCount: 0 });
    expect(item.metadata).toMatchObject({ channelId: "UCabc" });
  });

  it("stores null content when no transcript is available", () => {
    const entry: YoutubeFeedEntry = {
      videoId: "novideoxxxx",
      title: "No transcript video",
      publishedAt: null,
      channelTitle: "Some Channel",
      viewCount: 0,
    };
    const item = buildYoutubeRawItem(entry, { name: "Some Channel", channelRef: "@somechannel" }, "UCabc", null);
    expect(item.content).toBeNull();
  });
});

describe("collectYoutube", () => {
  const config: YoutubeCollectConfig = {
    channels: [{ name: "Two Minute Papers", channelRef: "UCbfYPyITQ-7l4upoX8nvctg" }],
    maxItems: 10,
  };

  it("discovers new videos, fetches transcripts, and stores them", async () => {
    const xml = feedXml([
      { videoId: "video1aaaaa", title: "New AI paper", published: "2026-07-07T00:00:00+00:00" },
      { videoId: "video2bbbbb", title: "Another AI paper", published: "2026-07-06T00:00:00+00:00" },
    ]);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(xml));
    const fetchTranscriptFn = vi.fn().mockResolvedValue([{ text: "transcript", duration: 1, offset: 0 }]);
    const repo = makeRepo();

    const result = await collectYoutube({ rawItemsRepo: repo, fetchFn, fetchTranscriptFn }, config);

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsStored).toBe(2);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    expect(fetchTranscriptFn).toHaveBeenCalledTimes(2);
    expect(result.unitResults).toHaveLength(1);
    expect(result.unitResults?.[0].status).toBe("completed");
  });

  it("skips videos that already exist (dedup by externalId)", async () => {
    const xml = feedXml([
      { videoId: "existing111", title: "Already have this", published: "2026-07-07T00:00:00+00:00" },
      { videoId: "newvideo222", title: "Brand new", published: "2026-07-06T00:00:00+00:00" },
    ]);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(xml));
    const fetchTranscriptFn = vi.fn().mockResolvedValue([{ text: "t", duration: 1, offset: 0 }]);
    const repo = makeRepo(["existing111"]);

    const result = await collectYoutube({ rawItemsRepo: repo, fetchFn, fetchTranscriptFn }, config);

    expect(result.itemsFetched).toBe(1);
    expect(fetchTranscriptFn).toHaveBeenCalledTimes(1);
    expect(fetchTranscriptFn).toHaveBeenCalledWith("newvideo222");
  });

  it("applies sinceDays filtering", async () => {
    const now = new Date("2026-07-10T00:00:00Z");
    const xml = feedXml([
      { videoId: "recentvideo", title: "Recent", published: "2026-07-09T00:00:00+00:00" },
      { videoId: "oldvideo1234", title: "Old", published: "2026-01-01T00:00:00+00:00" },
    ]);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(xml));
    const fetchTranscriptFn = vi.fn().mockResolvedValue([{ text: "t", duration: 1, offset: 0 }]);
    const repo = makeRepo();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = await collectYoutube(
      { rawItemsRepo: repo, fetchFn, fetchTranscriptFn },
      { ...config, sinceDays: 3 },
    );

    vi.useRealTimers();
    expect(result.itemsFetched).toBe(1);
    expect(fetchTranscriptFn).toHaveBeenCalledWith("recentvideo");
  });

  it("caps items per channel at maxItems", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      videoId: `video${String(i)}aaaaaaa`.slice(0, 11),
      title: `Video ${String(i)}`,
      published: "2026-07-07T00:00:00+00:00",
    }));
    const xml = feedXml(entries);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(xml));
    const fetchTranscriptFn = vi.fn().mockResolvedValue([{ text: "t", duration: 1, offset: 0 }]);
    const repo = makeRepo();

    const result = await collectYoutube(
      { rawItemsRepo: repo, fetchFn, fetchTranscriptFn },
      { ...config, maxItems: 2 },
    );

    expect(result.itemsFetched).toBe(2);
  });

  it("isolates a failing channel from a succeeding one", async () => {
    const twoChannelConfig: YoutubeCollectConfig = {
      channels: [
        { name: "Broken channel", channelRef: "@doesnotexist" },
        { name: "Two Minute Papers", channelRef: "UCbfYPyITQ-7l4upoX8nvctg" },
      ],
      maxItems: 10,
    };
    const xml = feedXml([{ videoId: "goodvideo12", title: "Good video", published: "2026-07-07T00:00:00+00:00" }]);
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(jsonResponse("", false, 404)))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(xml)));
    const fetchTranscriptFn = vi.fn().mockResolvedValue([{ text: "t", duration: 1, offset: 0 }]);
    const repo = makeRepo();

    const result = await collectYoutube({ rawItemsRepo: repo, fetchFn, fetchTranscriptFn }, twoChannelConfig);

    expect(result.itemsFetched).toBe(1);
    expect(result.unitResults).toHaveLength(2);
    expect(result.unitResults?.[0].status).toBe("failed");
    expect(result.unitResults?.[1].status).toBe("completed");
  });

  it("throws when every channel fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse("", false, 500));
    const repo = makeRepo();

    await expect(
      collectYoutube({ rawItemsRepo: repo, fetchFn, fetchTranscriptFn: vi.fn() }, config),
    ).rejects.toThrow(/all YouTube channels failed/);
  });

  it("returns an empty result immediately when no channels are configured", async () => {
    const fetchFn = vi.fn();
    const repo = makeRepo();
    const result = await collectYoutube(
      { rawItemsRepo: repo, fetchFn, fetchTranscriptFn: vi.fn() },
      { channels: [], maxItems: 10 },
    );
    expect(result.itemsFetched).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });
});

describe("parseYoutubeVideoIdFromUrl", () => {
  it("parses a standard watch URL", () => {
    expect(parseYoutubeVideoIdFromUrl("https://www.youtube.com/watch?v=1yBU41auQhw")).toBe("1yBU41auQhw");
  });

  it("parses a youtu.be short link", () => {
    expect(parseYoutubeVideoIdFromUrl("https://youtu.be/1yBU41auQhw")).toBe("1yBU41auQhw");
  });

  it("parses a /shorts/ URL", () => {
    expect(parseYoutubeVideoIdFromUrl("https://www.youtube.com/shorts/1yBU41auQhw")).toBe("1yBU41auQhw");
  });

  it("returns null for a channel URL", () => {
    expect(parseYoutubeVideoIdFromUrl("https://www.youtube.com/@lexfridman")).toBeNull();
  });

  it("returns null for a non-YouTube URL", () => {
    expect(parseYoutubeVideoIdFromUrl("https://example.com/watch?v=1yBU41auQhw")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseYoutubeVideoIdFromUrl("not a url")).toBeNull();
  });
});

describe("fetchYoutubePost", () => {
  it("fetches a single video and builds a RawItemInsert with transcript content", async () => {
    const html = `<html><head><title>Cool AI Video - YouTube</title></head><body>"author":"Cool Channel","externalId":"UCabcxyz0000000000000"</body></html>`;
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(html));
    const fetchTranscriptFn = vi.fn().mockResolvedValue([{ text: "transcript body", duration: 1, offset: 0 }]);

    const item: RawItemInsert = await fetchYoutubePost("https://www.youtube.com/watch?v=1yBU41auQhw", {
      fetchFn,
      fetchTranscriptFn,
    });

    expect(item.sourceType).toBe("youtube");
    expect(item.externalId).toBe("1yBU41auQhw");
    expect(item.title).toBe("Cool AI Video");
    expect(item.author).toBe("Cool Channel");
    expect(item.content).toBe("transcript body");
  });

  it("throws UrlParseError for a non-video URL", async () => {
    await expect(fetchYoutubePost("https://www.youtube.com/@lexfridman")).rejects.toThrow(
      /not a recognized YouTube video URL/,
    );
  });
});

import { describe, it, expect } from "vitest";
import { buildItemPreview } from "@api/services/item-preview.js";
import type { RawItemMetadata } from "@newsletter/shared";

// Minimal row shape needed by buildItemPreview
interface PreviewRow {
  sourceType: string;
  url: string;
  sourceUrl: string | null;
  content: string | null;
  author: string | null;
  metadata: RawItemMetadata;
}

function makeRow(overrides: Partial<PreviewRow> = {}): PreviewRow {
  return {
    sourceType: "blog",
    url: "https://example.com/post",
    sourceUrl: null,
    content: null,
    author: null,
    metadata: { comments: [] },
    ...overrides,
  };
}

describe("buildItemPreview (STEP-1)", () => {
  // ---- TWEET PREVIEW (EDGE-011) ----
  describe("tweet items", () => {
    it("EDGE-011: builds TweetPreview with quoted tweet", () => {
      const row = makeRow({
        sourceType: "twitter",
        url: "https://x.com/karpathy/status/123",
        sourceUrl: "https://x.com/karpathy/status/123",
        content: "This is a tweet",
        author: "karpathy",
        metadata: {
          comments: [],
          quotedTweet: {
            id: "456",
            authorHandle: "sama",
            fullText: "Quoted tweet text",
            url: "https://x.com/sama/status/456",
            createdAt: "2026-05-01T10:00:00Z",
            photoUrls: ["https://pbs.twimg.com/media/photo.jpg"],
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("tweet");
      if (preview.kind !== "tweet") return;
      expect(preview.handle).toBe("karpathy");
      expect(preview.text).toBe("This is a tweet");
      expect(preview.url).toBe("https://x.com/karpathy/status/123");
      expect(preview.quoted).toEqual({ handle: "sama", text: "Quoted tweet text" });
      expect(preview.photoUrls).toEqual(["https://pbs.twimg.com/media/photo.jpg"]);
    });

    it("builds TweetPreview without quoted tweet", () => {
      const row = makeRow({
        sourceType: "twitter",
        url: "https://x.com/karpathy/status/123",
        sourceUrl: null,
        content: "Tweet without quote",
        author: "karpathy",
        metadata: { comments: [] },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("tweet");
      if (preview.kind !== "tweet") return;
      expect(preview.quoted).toBeNull();
      expect(preview.photoUrls).toEqual([]);
      expect(preview.handle).toBe("karpathy");
    });

    it("uses sourceUrl as url when url is not the twitter status", () => {
      const row = makeRow({
        sourceType: "twitter",
        url: "https://example.com/article",
        sourceUrl: "https://x.com/user/status/789",
        content: "Tweet text",
        author: "user",
        metadata: { comments: [] },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("tweet");
      if (preview.kind !== "tweet") return;
      // sourceUrl ?? url → sourceUrl
      expect(preview.url).toBe("https://x.com/user/status/789");
    });

    it("handles null content for tweet", () => {
      const row = makeRow({
        sourceType: "twitter",
        url: "https://x.com/user/status/1",
        content: null,
        author: "user",
        metadata: { comments: [] },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("tweet");
      if (preview.kind !== "tweet") return;
      expect(preview.text).toBe("");
    });
  });

  // ---- LINK PREVIEW ----
  describe("link items with enrichedLink ok", () => {
    it("builds LinkPreview when enrichedLink.status=ok", () => {
      const row = makeRow({
        sourceType: "blog",
        url: "https://openai.com/research",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://openai.com/research",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "ok",
            title: "GPT-5 Research",
            byline: "OpenAI Team",
            description: "Introducing GPT-5",
            imageUrl: "https://openai.com/img.png",
            domain: "openai.com",
            markdown: "# GPT-5\n\nThis is the content",
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("link");
      if (preview.kind !== "link") return;
      expect(preview.title).toBe("GPT-5 Research");
      expect(preview.byline).toBe("OpenAI Team");
      expect(preview.description).toBe("Introducing GPT-5");
      expect(preview.imageUrl).toBe("https://openai.com/img.png");
      expect(preview.domain).toBe("openai.com");
      expect(preview.url).toBe("https://openai.com/research");
      expect(preview.markdownExcerpt).toBe("# GPT-5\n\nThis is the content");
    });

    it("REQ-009/EDGE-007: truncates markdownExcerpt to 4096 from 100KB", () => {
      const bigMarkdown = "x".repeat(100_000);
      const row = makeRow({
        sourceType: "blog",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://blog.example.com/post",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "ok",
            markdown: bigMarkdown,
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("link");
      if (preview.kind !== "link") return;
      expect(preview.markdownExcerpt).not.toBeNull();
      expect(preview.markdownExcerpt?.length).toBe(4096);
    });

    it("sets markdownExcerpt to null when enrichedLink has no markdown", () => {
      const row = makeRow({
        sourceType: "hn",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://news.ycombinator.com",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "ok",
            title: "Some title",
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("link");
      if (preview.kind !== "link") return;
      expect(preview.markdownExcerpt).toBeNull();
    });
  });

  describe("non-ok enrichedLink → none (EDGE-003 / REQ-012)", () => {
    it("EDGE-003: returns kind=none when enrichedLink.status=failed", () => {
      const row = makeRow({
        sourceType: "blog",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://blog.example.com",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "failed",
            failureReason: "timeout",
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("none");
    });

    it("returns kind=none when enrichedLink.status=skipped", () => {
      const row = makeRow({
        sourceType: "rss",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://rss.example.com",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "skipped",
            skipReason: "same-platform",
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("none");
    });

    it("returns kind=none when no enrichedLink at all", () => {
      const row = makeRow({
        sourceType: "rss",
        metadata: { comments: [] },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("none");
    });
  });

  describe("markdown excerpt is raw text (no sanitization at server)", () => {
    it("passes hostile HTML through as raw string — sanitization is web's job", () => {
      const hostile = "<script>alert('xss')</script> Some content";
      const row = makeRow({
        sourceType: "blog",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://blog.example.com",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "ok",
            markdown: hostile,
          },
        },
      });
      const preview = buildItemPreview(row);
      expect(preview.kind).toBe("link");
      if (preview.kind !== "link") return;
      // Server just slices — no sanitization
      expect(preview.markdownExcerpt).toBe(hostile);
    });
  });
});

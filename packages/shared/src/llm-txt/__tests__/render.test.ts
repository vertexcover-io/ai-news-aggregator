import { describe, it, expect } from "vitest";
import {
  absoluteUrl,
  renderIssueLlmTxt,
  renderCanonLlmTxt,
  renderIndexLlmsTxt,
  renderIndexLlmsFullTxt,
} from "../render.js";
import { LLM_TXT_SITE, LLM_TXT_STATIC_PAGES } from "../static-pages.js";
import type {
  IssueMeta,
  LlmTxtStory,
  IssueIndexEntry,
} from "../types.js";
import type { PublicMustReadEntry } from "@shared/types/must-read.js";

const baseUrl = "https://news.example.com";
const opts = { baseUrl };

const issueMeta: IssueMeta = {
  runId: "run-123",
  issueDate: "2026-06-17",
  digestHeadline: "Models get cheaper, agents get real",
  digestSummary: "A summary of today's AI news.",
};

const stories: LlmTxtStory[] = [
  {
    title: "OpenAI ships a thing",
    url: "https://openai.com/thing",
    recap: {
      title: "OpenAI ships a thing",
      summary: "They shipped it.",
      bullets: ["bullet one", "bullet two"],
      bottomLine: "It matters.",
    },
  },
  {
    title: "Anthropic responds",
    url: "https://anthropic.com/respond",
    recap: null,
  },
];

const canon: PublicMustReadEntry[] = [
  {
    id: "c1",
    url: "https://essay.example/attention",
    title: "Attention Is All You Need",
    author: "Vaswani et al.",
    year: 2017,
    annotation: "The transformer paper.",
    addedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "c2",
    url: "https://essay.example/bitter-lesson",
    title: "The Bitter Lesson",
    author: "Rich Sutton",
    year: 2019,
    annotation: "Compute wins.",
    addedAt: "2026-01-02T00:00:00.000Z",
  },
];

const issueIndex: IssueIndexEntry[] = [
  { runId: "run-123", issueDate: "2026-06-17", digestHeadline: "Models get cheaper" },
];

describe("absoluteUrl", () => {
  it("joins base and relative path without double slashes", () => {
    expect(absoluteUrl(baseUrl, "/archive/x")).toBe("https://news.example.com/archive/x");
    expect(absoluteUrl(baseUrl + "/", "/archive/x")).toBe("https://news.example.com/archive/x");
  });

  it("passes through already-absolute URLs", () => {
    expect(absoluteUrl(baseUrl, "https://other.com/a")).toBe("https://other.com/a");
  });
});

describe("renderIssueLlmTxt", () => {
  const out = renderIssueLlmTxt(issueMeta, stories, opts);

  it("renders an H1 headline and blockquote summary", () => {
    expect(out).toContain("# Models get cheaper, agents get real");
    expect(out).toContain("> A summary of today's AI news.");
    expect(out).toContain("2026-06-17");
  });

  it("renders each story as a linked section with recap content", () => {
    expect(out).toContain("[OpenAI ships a thing](https://openai.com/thing)");
    expect(out).toContain("They shipped it.");
    expect(out).toContain("- bullet one");
    expect(out).toContain("It matters.");
    expect(out).toContain("[Anthropic responds](https://anthropic.com/respond)");
  });
});

describe("renderCanonLlmTxt", () => {
  it("renders an H1 and one link line per entry with annotation", () => {
    const out = renderCanonLlmTxt(canon, opts);
    expect(out).toContain("# Canon");
    expect(out).toContain("[Attention Is All You Need](https://essay.example/attention)");
    expect(out).toContain("The transformer paper.");
    expect(out).toContain("[The Bitter Lesson](https://essay.example/bitter-lesson)");
  });
});

describe("renderIndexLlmsTxt", () => {
  it("renders site title, summary, and all sections with absolute links", () => {
    const out = renderIndexLlmsTxt({
      site: LLM_TXT_SITE,
      issues: issueIndex,
      canon,
      staticPages: LLM_TXT_STATIC_PAGES,
      opts,
    });
    expect(out.startsWith("# ")).toBe(true);
    expect(out).toContain(LLM_TXT_SITE.title);
    expect(out).toContain("> " + LLM_TXT_SITE.summary);
    expect(out).toContain("## Issues");
    expect(out).toContain("## Canon");
    expect(out).toContain("## How we build it");
    expect(out).toContain("https://news.example.com/archive/run-123");
    expect(out).not.toContain("https://news.example.com//");
  });

  it("handles empty issues with a 'none yet' note, no empty section", () => {
    const out = renderIndexLlmsTxt({
      site: LLM_TXT_SITE,
      issues: [],
      canon: [],
      staticPages: LLM_TXT_STATIC_PAGES,
      opts,
    });
    expect(out).toContain("## Issues");
    expect(out.toLowerCase()).toContain("none");
  });
});

describe("renderIndexLlmsFullTxt", () => {
  it("inlines issue content under the index", () => {
    const out = renderIndexLlmsFullTxt({
      site: LLM_TXT_SITE,
      issues: issueIndex,
      canon,
      staticPages: LLM_TXT_STATIC_PAGES,
      opts,
      issuesFull: [{ meta: issueMeta, stories }],
    });
    expect(out).toContain("## Issues");
    expect(out).toContain("[OpenAI ships a thing](https://openai.com/thing)");
    expect(out).toContain("They shipped it.");
  });
});

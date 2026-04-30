import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ArchiveStoryCard } from "../../../src/components/ArchiveStoryCard";
import type { RankedItem } from "@newsletter/shared";

afterEach(() => {
  cleanup();
});

const twitterItemWithImage: RankedItem = {
  id: 42,
  rawItemId: 420,
  title: "OpenAI announces GPT-5",
  url: "https://x.com/openai/status/1234567890",
  sourceType: "twitter",
  author: "openai",
  publishedAt: "2026-04-30T10:00:00Z",
  engagement: { points: 1500, commentCount: 300 },
  score: 0.95,
  rationale: "Major announcement from OpenAI",
  content: "Exciting news about GPT-5...",
  imageUrl: "https://pbs.twimg.com/media/abc123.jpg",
  recap: null,
};

const twitterItemNoImage: RankedItem = {
  ...twitterItemWithImage,
  id: 43,
  rawItemId: 421,
  imageUrl: null,
};

describe("ArchiveStoryCard Twitter — REQ-064", () => {
  // REQ-064: twitter item with imageUrl renders image plate identical to other source types
  it("REQ-064: renders image plate for sourceType=twitter when imageUrl is non-null", () => {
    const { container } = render(
      <ArchiveStoryCard item={twitterItemWithImage} rank={1} totalCount={5} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(
      "https://pbs.twimg.com/media/abc123.jpg",
    );
  });

  it("REQ-064: image plate is absent for sourceType=twitter when imageUrl is null", () => {
    const { container } = render(
      <ArchiveStoryCard item={twitterItemNoImage} rank={1} totalCount={5} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("REQ-064: sourceType twitter appears uppercase in eyebrow", () => {
    const { container } = render(
      <ArchiveStoryCard item={twitterItemWithImage} rank={1} totalCount={5} />,
    );
    expect(container.textContent).toContain("TWITTER");
  });

  it("REQ-064: twitter item renders inside an article element", () => {
    render(
      <ArchiveStoryCard item={twitterItemWithImage} rank={1} totalCount={5} />,
    );
    const articles = screen.getAllByRole("article");
    expect(articles.length).toBeGreaterThanOrEqual(1);
  });
});

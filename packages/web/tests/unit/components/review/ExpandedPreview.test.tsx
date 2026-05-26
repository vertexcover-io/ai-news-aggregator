import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ItemPreview } from "@newsletter/shared/types";
import { ExpandedPreview } from "../../../../src/components/review/ExpandedPreview";

afterEach(() => {
  cleanup();
});

const tweetPreview: ItemPreview = {
  kind: "tweet",
  handle: "@karpathy",
  text: "New model is amazing",
  createdAt: "2026-04-15T10:00:00Z",
  photoUrls: [],
  url: "https://x.com/karpathy/status/1",
  quoted: null,
};

const tweetWithQuoted: ItemPreview = {
  kind: "tweet",
  handle: "@someuser",
  text: "My comment on this",
  createdAt: "2026-04-15T10:00:00Z",
  photoUrls: [],
  url: "https://x.com/someuser/status/2",
  quoted: {
    handle: "@original",
    text: "Original tweet text",
  },
};

const linkPreview: ItemPreview = {
  kind: "link",
  title: "Great Article Title",
  byline: "John Doe",
  description: "An excellent description",
  imageUrl: "https://example.com/og.png",
  domain: "example.com",
  markdownExcerpt: "**Key points** from the article",
  url: "https://example.com/great-article",
};

const noPreview: ItemPreview = {
  kind: "none",
};

describe("ExpandedPreview", () => {
  it("tweet kind: renders handle", () => {
    render(<ExpandedPreview preview={tweetPreview} recapSummary={null} />);
    expect(screen.getByText("@karpathy")).toBeTruthy();
  });

  it("tweet kind: renders tweet text", () => {
    render(<ExpandedPreview preview={tweetPreview} recapSummary={null} />);
    expect(screen.getByText("New model is amazing")).toBeTruthy();
  });

  it("tweet kind: renders 'view on X' link", () => {
    render(<ExpandedPreview preview={tweetPreview} recapSummary={null} />);
    const link = screen.getByRole("link", { name: /view on x/i });
    expect(link.getAttribute("href")).toBe("https://x.com/karpathy/status/1");
  });

  it("EDGE-011: tweet kind with quoted tweet renders quoted handle and text", () => {
    render(<ExpandedPreview preview={tweetWithQuoted} recapSummary={null} />);
    expect(screen.getByText("@original")).toBeTruthy();
    expect(screen.getByText("Original tweet text")).toBeTruthy();
  });

  it("link kind: renders title", () => {
    render(<ExpandedPreview preview={linkPreview} recapSummary={null} />);
    expect(screen.getByText("Great Article Title")).toBeTruthy();
  });

  it("link kind: renders domain", () => {
    render(<ExpandedPreview preview={linkPreview} recapSummary={null} />);
    expect(screen.getByText("example.com")).toBeTruthy();
  });

  it("link kind: renders markdown excerpt via SafeMarkdown", () => {
    render(<ExpandedPreview preview={linkPreview} recapSummary={null} />);
    // Bold text from markdownExcerpt
    const strong = document.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("Key points");
  });

  it("link kind: renders open source link", () => {
    render(<ExpandedPreview preview={linkPreview} recapSummary={null} />);
    const link = screen.getByRole("link", { name: /open source/i });
    expect(link.getAttribute("href")).toBe("https://example.com/great-article");
  });

  it("EDGE-003: none kind renders fallback text (never blank)", () => {
    render(<ExpandedPreview preview={noPreview} recapSummary={null} />);
    // Should show "Full preview unavailable"
    expect(screen.getByText(/full preview unavailable/i)).toBeTruthy();
  });

  it("EDGE-003: none kind with recapSummary shows the summary", () => {
    render(
      <ExpandedPreview
        preview={noPreview}
        recapSummary="This is a recap summary."
      />,
    );
    expect(screen.getByText("This is a recap summary.")).toBeTruthy();
  });

  it("none kind with no recapSummary shows unavailable text and never blank", () => {
    const { container } = render(
      <ExpandedPreview preview={noPreview} recapSummary={null} />,
    );
    // Container should not be empty
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });
});

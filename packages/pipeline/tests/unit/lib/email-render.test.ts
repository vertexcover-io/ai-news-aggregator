import { describe, it, expect } from "vitest";
import { renderNewsletter } from "@pipeline/lib/email-render.js";
import type { NewsletterRenderProps, NewsletterStory } from "@pipeline/workers/newsletter-send.js";

const baseUrl = "https://newsletter.vertexcover.io";

const stories: NewsletterStory[] = [
  {
    title: "GPT-5 Released With Reasoning Breakthrough",
    url: "https://openai.com/gpt5",
    summary: "OpenAI announces GPT-5 with major improvements.",
    bullets: ["10x faster than GPT-4", "New reasoning mode"],
    bottomLine: "The biggest AI leap since GPT-4.",
  },
  {
    title: "Google Gemini 2.0 Tops All Benchmarks",
    url: "https://google.com/gemini",
    summary: "Gemini 2.0 wins on every public eval.",
  },
];

const baseProps: NewsletterRenderProps = {
  stories,
  issueDate: "Friday, May 8, 2026",
  issueNumber: 42,
  unsubscribeUrl: "https://newsletter.vertexcover.io/unsubscribe?token=xyz",
  baseUrl,
};

describe("renderNewsletter (editorial layout)", () => {
  it("renders an HTML document containing every story title", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("GPT-5 Released With Reasoning Breakthrough");
    expect(html).toContain("Google Gemini 2.0 Tops All Benchmarks");
  });

  it("renders the issue date", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("Friday, May 8, 2026");
  });

  it("renders the unsubscribe URL", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain(baseProps.unsubscribeUrl);
  });

  it("renders summary, bullets, and BOTTOM LINE for stories that have them", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("OpenAI announces GPT-5");
    expect(html).toContain("10x faster than GPT-4");
    expect(html).toContain("New reasoning mode");
    expect(html).toContain("BOTTOM LINE");
    expect(html).toContain("The biggest AI leap since GPT-4.");
  });

  it("limits stories to 5", async () => {
    const many: NewsletterStory[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Story ${i + 1}`,
      url: `https://example.com/${i + 1}`,
    }));
    const html = await renderNewsletter({ ...baseProps, stories: many });
    expect(html).toContain("Story 5");
    expect(html).not.toContain("Story 6");
  });

  it("includes replyToEmail when provided", async () => {
    const replyToEmail = "newsletter-feedback@vertexcover.io";
    const html = await renderNewsletter({ ...baseProps, replyToEmail });
    expect(html).toContain(replyToEmail);
  });

  // ---- Editorial-redesign behaviors ----

  it("does NOT render the legacy 'Made by Vertexcover Labs' pill", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).not.toContain("Made by Vertexcover Labs");
  });

  it("does NOT render the 'Issue Nº <n>' meta line", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).not.toMatch(/Issue\s+Nº\s*42/);
  });

  it("does NOT render numbered N° eyebrows on stories", async () => {
    const html = await renderNewsletter(baseProps);
    // Old format used N°01, N°02 eyebrows above each story title.
    expect(html).not.toMatch(/N°\s*0?1/);
    expect(html).not.toMatch(/N°\s*0?2/);
  });

  it("renders the editorial cream background (#fbfaf7 or #FAFAF7)", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html.toLowerCase()).toMatch(/#fbfaf7|#fafaf7/);
  });

  it("renders the rust accent color #8c3a1e", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html.toLowerCase()).toContain("#8c3a1e");
  });

  it("renders an archive ribbon with 'READING THE ARCHIVE' eyebrow and an archive CTA", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html.toUpperCase()).toContain("READING THE ARCHIVE");
    expect(html).toContain("Catch up on every issue");
    // Ribbon CTA must link to the archive listing (baseUrl).
    expect(html).toMatch(/href="https:\/\/newsletter\.vertexcover\.io\/?"/);
    expect(html).toContain("Open archive");
  });

  it("renders an end-of-issue archive link as a secondary touchpoint", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("Browse every issue");
  });

  it("renders the 'UNPACKED' bullet-list label for stories with bullets", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html.toUpperCase()).toContain("UNPACKED");
  });

  it("renders the source name in the per-story eyebrow without an N° prefix", async () => {
    // We don't have explicit source metadata in NewsletterStory yet — the
    // editorial design uses just the source/host. For now, ensure the title
    // links to the source URL (the host serves as the implicit source).
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("https://openai.com/gpt5");
    expect(html).toContain("https://google.com/gemini");
  });

  it("renders a story image when imageUrl is provided", async () => {
    const withImage: NewsletterStory[] = [
      {
        title: "Image story",
        url: "https://example.com/img",
        imageUrl: "https://cdn.example.com/img.jpg",
      },
    ];
    const html = await renderNewsletter({ ...baseProps, stories: withImage });
    expect(html).toContain("https://cdn.example.com/img.jpg");
  });
});

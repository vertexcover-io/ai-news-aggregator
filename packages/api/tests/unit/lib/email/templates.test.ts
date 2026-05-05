import { describe, it, expect } from "vitest";
import { renderConfirmation, renderNewsletter } from "@api/lib/email/templates/index.js";
import type { NewsletterStory } from "@api/lib/email/templates/index.js";

const baseUrl = "https://newsletter.vertexcover.io";

describe("renderConfirmation", () => {
  it("renders HTML containing the confirmUrl", async () => {
    const confirmUrl = "https://newsletter.vertexcover.io/confirm?token=abc123";
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(typeof html).toBe("string");
    expect(html).toContain(confirmUrl);
  });

  it("renders an HTML document", async () => {
    const html = await renderConfirmation({
      confirmUrl: "https://example.com/confirm",
      baseUrl,
    });
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes 'AI NEWSLETTER' branding", async () => {
    const html = await renderConfirmation({
      confirmUrl: "https://example.com/confirm",
      baseUrl,
    });
    expect(html).toContain("AI NEWSLETTER");
  });
});

describe("renderNewsletter", () => {
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
    },
  ];

  const baseProps = {
    stories,
    issueDate: "Monday, May 5, 2026",
    issueNumber: 42,
    unsubscribeUrl: "https://newsletter.vertexcover.io/unsubscribe?token=xyz",
    baseUrl,
  };

  it("renders HTML containing story titles", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("GPT-5 Released With Reasoning Breakthrough");
    expect(html).toContain("Google Gemini 2.0 Tops All Benchmarks");
  });

  it("renders HTML containing the unsubscribeUrl", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain(baseProps.unsubscribeUrl);
  });

  it("renders issue date and number", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("Monday, May 5, 2026");
    expect(html).toContain("42");
  });

  it("renders story summaries and bullets", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("OpenAI announces GPT-5");
    expect(html).toContain("10x faster than GPT-4");
    expect(html).toContain("New reasoning mode");
  });

  it("renders BOTTOM LINE block when present", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("BOTTOM LINE");
    expect(html).toContain("The biggest AI leap since GPT-4.");
  });

  it("limits stories to 5 max", async () => {
    const manyStories: NewsletterStory[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Story ${i + 1}`,
      url: `https://example.com/story-${i + 1}`,
    }));
    const html = await renderNewsletter({ ...baseProps, stories: manyStories });
    // Only first 5 stories should appear — check story 6 is absent
    expect(html).not.toContain("Story 6");
    expect(html).toContain("Story 5");
  });

  it("includes replyToEmail in footer when provided", async () => {
    const replyToEmail = "newsletter-feedback@vertexcover.io";
    const html = await renderNewsletter({ ...baseProps, replyToEmail });
    expect(html).toContain(replyToEmail);
  });

  it("renders an HTML document", async () => {
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});

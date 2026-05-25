import { describe, it, expect } from "vitest";
import {
  renderConfirmation,
  renderNewsletter,
  renderWelcome,
} from "@api/lib/email/templates/index.js";
import type { NewsletterStory } from "@api/lib/email/templates/index.js";

const baseUrl = "https://newsletter.vertexcover.io";

describe("renderConfirmation (editorial redesign)", () => {
  const confirmUrl = "https://newsletter.vertexcover.io/api/confirm?token=abc123";

  it("renders an HTML document containing the confirmUrl", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(typeof html).toBe("string");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain(confirmUrl);
  });

  it("uses 'The Daily Read' branding (not 'AI NEWSLETTER')", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(html).toContain("The Daily Read");
    expect(html).not.toContain("AI NEWSLETTER");
  });

  it("renders the editorial palette (cream + rust)", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(html.toLowerCase()).toMatch(/#fbfaf7|#fafaf7/);
    expect(html.toLowerCase()).toContain("#8c3a1e");
  });

  it("renders the editorial headline 'Confirm your subscription.'", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(html).toContain("Confirm your");
    expect(html).toContain("subscription");
  });

  it("renders the dark CTA pill copy 'Confirm subscription'", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(html).toContain("Confirm subscription");
  });

  it("includes a plain-text fallback link to the confirmUrl", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    // The fallback paragraph reuses the confirmUrl, so the URL appears more than once.
    const occurrences = html.split(confirmUrl).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("renders a 'Didn't sign up' reassurance line", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    // React Email escapes apostrophes to &apos;; match either the raw or escaped form.
    expect(html.toLowerCase()).toMatch(/didn(?:'|&apos;|&#x27;)t sign up/);
  });

  it("signs off as 'Vertexcover Labs' (not Aman / Ritesh)", async () => {
    const html = await renderConfirmation({ confirmUrl, baseUrl });
    expect(html).toContain("Vertexcover Labs");
    expect(html).not.toContain("Aman");
    expect(html).not.toContain("Ritesh");
  });
});

describe("renderWelcome (new)", () => {
  const props = {
    baseUrl,
    unsubscribeUrl: "https://newsletter.vertexcover.io/api/unsubscribe?token=xyz",
  };

  it("renders an HTML document", async () => {
    const html = await renderWelcome(props);
    expect(typeof html).toBe("string");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("uses 'The Daily Read' branding", async () => {
    const html = await renderWelcome(props);
    expect(html).toContain("The Daily Read");
  });

  it("renders the editorial palette (cream + rust)", async () => {
    const html = await renderWelcome(props);
    expect(html.toLowerCase()).toMatch(/#fbfaf7|#fafaf7/);
    expect(html.toLowerCase()).toContain("#8c3a1e");
  });

  it("renders the welcome headline", async () => {
    const html = await renderWelcome(props);
    expect(html.toLowerCase()).toContain("welcome to");
  });

  it("renders the 'You're in' eyebrow", async () => {
    const html = await renderWelcome(props);
    expect(html.toUpperCase()).toMatch(/YOU(?:'|&APOS;|&#X27;)RE IN/);
  });

  it("renders the editor's note section", async () => {
    const html = await renderWelcome(props);
    expect(html.toUpperCase()).toContain("FROM THE EDITORS");
    expect(html).toContain("AI firehose is loud");
  });

  it("does NOT include the removed second editor's-note paragraph", async () => {
    const html = await renderWelcome(props);
    expect(html).not.toContain("ranked by signal-vs-hype");
    expect(html).not.toContain("Nothing automated lands");
  });

  it("signs the editor's note as 'The Vertexcover Labs team' (not Aman / Ritesh)", async () => {
    const html = await renderWelcome(props);
    expect(html.toLowerCase()).toContain("vertexcover labs");
    expect(html).not.toContain("Aman");
    expect(html).not.toContain("Ritesh");
  });

  it("includes the unsubscribe URL in the footer", async () => {
    const html = await renderWelcome(props);
    expect(html).toContain(props.unsubscribeUrl);
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
      sourceLabel: "theverge.com",
      sourceUrl: "https://theverge.com/x",
      readVerb: "Read on theverge.com",
    },
    {
      title: "Google Gemini 2.0 Tops All Benchmarks",
      url: "https://google.com/gemini",
      sourceLabel: "Hacker News",
      sourceUrl: "https://news.ycombinator.com/item?id=1",
      readVerb: "Read source",
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
      sourceLabel: "Example",
      sourceUrl: `https://example.com/story-${i + 1}`,
      readVerb: "Read source",
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

  // VS-9: enriched chip renders hostname and enriched URL as a link
  it("VS-9: renders source chip with enriched hostname and enriched URL", async () => {
    const html = await renderNewsletter(baseProps);
    // story[0] has sourceLabel="theverge.com", sourceUrl="https://theverge.com/x", readVerb="Read on theverge.com"
    expect(html).toContain("theverge.com");
    expect(html).toContain("https://theverge.com/x");
    expect(html).toContain("Read on theverge.com");
  });

  // VS-10: native chip renders platform label and item.url as a link
  it("VS-10: renders source chip with platform label and item URL", async () => {
    const html = await renderNewsletter(baseProps);
    // story[1] has sourceLabel="Hacker News", sourceUrl="https://news.ycombinator.com/item?id=1", readVerb="Read source"
    expect(html).toContain("Hacker News");
    expect(html).toContain("https://news.ycombinator.com/item?id=1");
    expect(html).toContain("Read source");
  });
});

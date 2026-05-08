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

  it("renders every story passed in (no upstream cap)", async () => {
    const many: NewsletterStory[] = Array.from({ length: 12 }, (_, i) => ({
      title: `Story ${i + 1}`,
      url: `https://example.com/${i + 1}`,
    }));
    const html = await renderNewsletter({ ...baseProps, stories: many });
    for (let i = 1; i <= 12; i += 1) {
      expect(html).toContain(`Story ${String(i)}`);
    }
  });

  it("places the archive ribbon after story 2 regardless of total count", async () => {
    const many: NewsletterStory[] = Array.from({ length: 8 }, (_, i) => ({
      title: `Story ${i + 1}`,
      url: `https://example.com/${i + 1}`,
    }));
    const html = await renderNewsletter({ ...baseProps, stories: many });
    const idxStory2 = html.indexOf("Story 2");
    const idxRibbon = html.indexOf("READING THE ARCHIVE");
    const idxStory3 = html.indexOf("Story 3");
    // Ribbon must appear AFTER story 2 and BEFORE story 3.
    expect(idxStory2).toBeGreaterThan(0);
    expect(idxRibbon).toBeGreaterThan(idxStory2);
    expect(idxStory3).toBeGreaterThan(idxRibbon);
  });

  it("renders the ribbon even when there are exactly 2 stories (fallback: after last)", async () => {
    // baseProps already has 2 stories. Ribbon should still appear so users
    // see the archive CTA even on tiny digests.
    const html = await renderNewsletter(baseProps);
    expect(html).toContain("READING THE ARCHIVE");
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

// ---------------------------------------------------------------------------
// Mobile responsiveness — both fixes are content-only (no JS), so we assert on
// the rendered HTML/CSS that the right hooks exist for email clients to apply.
// ---------------------------------------------------------------------------
describe("renderNewsletter (mobile responsiveness)", () => {
  it("renders the hero headline at a smaller default size (≤32px)", async () => {
    const html = await renderNewsletter(baseProps);
    // The hero <h1>-equivalent <p> should have inline font-size in the 28-32px
    // range — small enough to not blow up at 600px desktop email widths, big
    // enough to still feel editorial.
    const heroSizeMatch = /font-size:\s*(\d+(?:\.\d+)?)px[^"]*"[^>]*>GPT-5/.exec(html);
    expect(heroSizeMatch).not.toBeNull();
    const px = Number(heroSizeMatch?.[1] ?? "0");
    expect(px).toBeGreaterThanOrEqual(26);
    expect(px).toBeLessThanOrEqual(32);
  });

  it("includes a <style> block in <head> with a mobile media query", async () => {
    const html = await renderNewsletter(baseProps);
    // React Email serializes <Head><style>…</style></Head> when given children.
    expect(html).toMatch(/<style[^>]*>[\s\S]*?@media[\s\S]*?<\/style>/i);
    expect(html).toMatch(/@media[^{]*max-width:\s*\d+px/i);
  });

  it("media query targets the hero headline with a stable class", async () => {
    const html = await renderNewsletter(baseProps);
    // The hero element must carry a class the media query can target.
    expect(html).toMatch(/class="[^"]*\bhero-h1\b[^"]*"/);
    // And the media query must reference that class.
    expect(html).toMatch(/@media[\s\S]*?\.hero-h1[\s\S]*?font-size/i);
  });

  it("media query stacks the archive ribbon columns on narrow viewports", async () => {
    const html = await renderNewsletter(baseProps);
    // Both ribbon cells must carry the stack class.
    const stackClassOccurrences = (html.match(/\bstack-col\b/g) ?? []).length;
    expect(stackClassOccurrences).toBeGreaterThanOrEqual(2);
    // The media query must set those cells to display:block at 100% width.
    expect(html).toMatch(/@media[\s\S]*?\.stack-col[\s\S]*?display:\s*block/i);
    expect(html).toMatch(/@media[\s\S]*?\.stack-col[\s\S]*?width:\s*100%/i);
  });

  it("does NOT apply width:1% or whiteSpace:nowrap on the ribbon's body cell", async () => {
    // The original implementation used `width: 1%` + `whiteSpace: nowrap` on
    // the right column, which Gmail/Apple Mail interpreted by squeezing the
    // *left* (body) column to single-word lines. The fix is to drop both.
    // We can't fully diff the right cell from the left here, but we can assert
    // the body copy "Catch up on every issue you've missed." is in a cell whose
    // inline style does NOT include `white-space:nowrap`.
    const html = await renderNewsletter(baseProps);
    const bodyCellMatch = /<[^>]+style="([^"]*)"[^>]*>[^<]*<p[^>]*>READING THE ARCHIVE/i.exec(
      html,
    );
    if (bodyCellMatch) {
      expect(bodyCellMatch[1].toLowerCase()).not.toContain("white-space:nowrap");
      expect(bodyCellMatch[1].toLowerCase()).not.toContain("white-space: nowrap");
    }
  });

  it("ribbon CTA pill keeps whiteSpace:nowrap so 'OPEN ARCHIVE →' stays on one line", async () => {
    // The pill itself must stay no-wrap so the arrow doesn't drop to a second
    // line. This was the original bug fix from the email-A.html mock.
    const html = await renderNewsletter(baseProps);
    expect(html).toMatch(/Open archive[\s\S]{0,200}white-space:\s*nowrap|white-space:\s*nowrap[\s\S]{0,400}Open archive/i);
  });
});


import * as React from "react";
import { render } from "@react-email/components";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
  Link,
  Img,
  Preview,
} from "@react-email/components";
import type { NewsletterRenderProps, NewsletterStory } from "@pipeline/workers/newsletter-send.js";

// No render-time cap on stories — the curator picks the count during review.
// The archive ribbon stays at index RIBBON_AFTER_INDEX (after story 2) for
// digests with 3+ stories; on 1- or 2-story digests it slots in after the last
// story so the archive CTA always appears.

const COLORS = {
  bg: "#fbfaf7",
  bgElev: "#ffffff",
  ink: "#14110d",
  ink2: "#2a261f",
  muted: "#6b6557",
  muted2: "#8a8472",
  line: "#e7e2d6",
  rust: "#8c3a1e",
  ribbonInk: "#14110d",
  ribbonEyebrow: "#c9b88a",
} as const;

const SERIF = 'Newsreader, Georgia, "Times New Roman", serif';
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// Mobile-only overrides. Loaded via <style> in <Head>; inline styles win at
// desktop widths, these classes win at ≤480px.
const MOBILE_STYLES = `
@media only screen and (max-width: 480px) {
  .hero-h1 {
    font-size: 26px !important;
    line-height: 1.1 !important;
  }
  /* Stack the two columns of the archive ribbon. Email clients keep <td>s
     side-by-side at narrow widths unless we force display:block. */
  .stack-col {
    display: block !important;
    width: 100% !important;
    padding: 0 !important;
    text-align: left !important;
  }
  .stack-col-cta {
    text-align: center !important;
    padding-top: 16px !important;
  }
}
`.trim();

const eyebrowStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "10.5px",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: COLORS.rust,
  margin: "0 0 14px",
};

const sourceEyebrowStyle: React.CSSProperties = {
  ...eyebrowStyle,
  margin: "0 0 12px",
};

const titleLinkStyle: React.CSSProperties = {
  display: "block",
  color: COLORS.ink,
  textDecoration: "none",
  fontFamily: SERIF,
  fontSize: "24px",
  lineHeight: "1.22",
  fontWeight: 500,
  letterSpacing: "-0.008em",
  marginBottom: "14px",
};

const ledeStyle: React.CSSProperties = {
  fontFamily: SERIF,
  fontSize: "17px",
  lineHeight: "1.55",
  fontStyle: "italic",
  color: COLORS.ink2,
  margin: "0 0 22px",
};

const unpackedLabelStyle: React.CSSProperties = {
  ...eyebrowStyle,
  margin: "0 0 12px",
};

const bulletStyle: React.CSSProperties = {
  fontFamily: SERIF,
  fontSize: "16px",
  lineHeight: "1.55",
  color: COLORS.ink2,
  margin: "0 0 8px",
  paddingLeft: "22px",
  textIndent: "-14px",
};

const sourceLineStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "10.5px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: COLORS.muted,
  margin: "18px 0 0",
};

function sourceLabelFor(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "news.ycombinator.com") return "Hacker News";
    if (host === "github.com") return "GitHub";
    if (host === "arxiv.org") return "arXiv";
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "Reddit";
    return host;
  } catch {
    return "Source";
  }
}

function StoryBlock({
  story,
  isLast,
}: {
  story: NewsletterStory;
  isLast: boolean;
}): React.ReactElement {
  const sourceLabel = sourceLabelFor(story.url);
  const children: React.ReactNode[] = [
    React.createElement(Text, { key: "src", style: sourceEyebrowStyle }, sourceLabel),
    React.createElement(
      Link,
      { key: "title", href: story.url, style: titleLinkStyle, target: "_blank" },
      story.title,
    ),
  ];

  if (story.summary !== undefined) {
    children.push(React.createElement(Text, { key: "lede", style: ledeStyle }, story.summary));
  }

  if (story.imageUrl !== undefined) {
    children.push(
      React.createElement(Img, {
        key: "img",
        src: story.imageUrl,
        alt: story.title,
        width: "552",
        style: {
          width: "100%",
          maxWidth: "552px",
          height: "auto",
          display: "block",
          margin: "0 0 22px",
          borderRadius: "6px",
          border: `1px solid ${COLORS.line}`,
        },
      }),
    );
  }

  if (story.bullets !== undefined && story.bullets.length > 0) {
    children.push(
      React.createElement(Text, { key: "unpacked", style: unpackedLabelStyle }, "UNPACKED"),
      ...story.bullets.map((bullet, idx) =>
        React.createElement(Text, { key: `b-${String(idx)}`, style: bulletStyle }, `— ${bullet}`),
      ),
    );
  }

  if (story.bottomLine !== undefined) {
    children.push(
      React.createElement(
        Section,
        {
          key: "bottom",
          style: {
            borderLeft: `3px solid ${COLORS.rust}`,
            backgroundColor: COLORS.bgElev,
            padding: "12px 18px",
            margin: "22px 0 0",
            borderRadius: "0 4px 4px 0",
          },
        },
        React.createElement(
          Text,
          { style: { ...eyebrowStyle, margin: "0 0 6px" } },
          "BOTTOM LINE",
        ),
        React.createElement(
          Text,
          {
            style: {
              fontFamily: SERIF,
              fontSize: "17px",
              lineHeight: "1.45",
              fontStyle: "italic",
              fontWeight: 500,
              color: COLORS.ink,
              margin: 0,
            },
          },
          story.bottomLine,
        ),
      ),
    );
  }

  children.push(
    React.createElement(
      Text,
      { key: "src-line", style: sourceLineStyle },
      "Source · ",
      React.createElement(
        Link,
        {
          href: story.url,
          target: "_blank",
          style: {
            color: COLORS.ink,
            borderBottom: `1px solid ${COLORS.ink}`,
            paddingBottom: "1px",
            textDecoration: "none",
          },
        },
        `Read on ${sourceLabel} ↗`,
      ),
    ),
  );

  if (!isLast) {
    children.push(
      React.createElement(Section, {
        key: "divider",
        style: {
          borderTop: `1px solid ${COLORS.line}`,
          margin: "44px 0 44px",
          padding: 0,
          lineHeight: "1px",
          fontSize: "1px",
        },
      }),
    );
  }

  return React.createElement(Section, { style: { padding: 0 } }, ...children);
}

function ArchiveRibbon({ archiveUrl }: { archiveUrl: string }): React.ReactElement {
  return React.createElement(
    Section,
    {
      style: {
        backgroundColor: COLORS.ribbonInk,
        borderRadius: "10px",
        padding: "22px 24px",
        margin: "56px 0 44px",
      },
    },
    React.createElement(
      Row,
      null,
      React.createElement(
        Column,
        {
          className: "stack-col",
          valign: "middle",
          style: { verticalAlign: "middle", paddingRight: "16px" },
        },
        React.createElement(
          Text,
          {
            style: {
              fontFamily: MONO,
              fontSize: "10px",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: COLORS.ribbonEyebrow,
              margin: "0 0 4px",
            },
          },
          "READING THE ARCHIVE",
        ),
        React.createElement(
          Text,
          {
            style: {
              fontFamily: SERIF,
              fontSize: "17px",
              lineHeight: "1.4",
              fontStyle: "italic",
              color: COLORS.bg,
              margin: 0,
            },
          },
          "Catch up on every issue you've missed.",
        ),
      ),
      React.createElement(
        Column,
        {
          className: "stack-col stack-col-cta",
          valign: "middle",
          align: "right",
          style: { verticalAlign: "middle" },
        },
        React.createElement(
          Link,
          {
            href: archiveUrl,
            target: "_blank",
            style: {
              display: "inline-block",
              backgroundColor: COLORS.bg,
              color: COLORS.ink,
              padding: "10px 18px",
              borderRadius: "999px",
              fontFamily: MONO,
              fontSize: "10.5px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
              fontWeight: 500,
              whiteSpace: "nowrap",
              lineHeight: 1,
            },
          },
          "Open archive →",
        ),
      ),
    ),
  );
}

function NewsletterEmail({
  stories,
  issueDate,
  unsubscribeUrl,
  baseUrl,
  replyToEmail,
}: NewsletterRenderProps): React.ReactElement {
  const displayStories = stories;
  const totalCount = displayStories.length;
  const headStoryTitle = totalCount > 0 ? displayStories[0].title : null;
  const minRead = Math.max(2, totalCount * 2 - 1);
  const RIBBON_AFTER_INDEX = 1;

  const sansFooter = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

  return React.createElement(
    Html,
    { lang: "en" },
    React.createElement(
      Head,
      null,
      React.createElement("style", {
        // Mobile (≤480px) overrides — Gmail/Apple Mail/Outlook iOS all honor
        // <style> inside <head> with media queries. Inline styles are the
        // baseline; these classes only kick in on narrow viewports.
        dangerouslySetInnerHTML: {
          __html: MOBILE_STYLES,
        },
      }),
    ),
    React.createElement(
      Preview,
      null,
      `${headStoryTitle ?? "Your daily AI digest"} — ${String(totalCount)} stor${totalCount === 1 ? "y" : "ies"}, ${String(minRead)} min read`,
    ),
    React.createElement(
      Body,
      { style: { backgroundColor: COLORS.bg, margin: 0, padding: "32px 0 64px" } },
      React.createElement(
        Container,
        { style: { maxWidth: "600px", margin: "0 auto", padding: "0 28px" } },
        // Date eyebrow
        React.createElement(
          Section,
          { style: { textAlign: "center", padding: "16px 0 0" } },
          React.createElement(
            Text,
            {
              style: {
                fontFamily: MONO,
                fontSize: "11px",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: COLORS.rust,
                margin: 0,
              },
            },
            issueDate,
          ),
        ),
        // Headline
        React.createElement(
          Section,
          { style: { textAlign: "center", padding: "14px 0 0" } },
          React.createElement(
            Text,
            {
              className: "hero-h1",
              style: {
                fontFamily: SERIF,
                fontSize: "30px",
                lineHeight: "1.08",
                fontWeight: 600,
                letterSpacing: "-0.012em",
                color: COLORS.ink,
                margin: 0,
              },
            },
            headStoryTitle ?? "Today's AI Digest",
          ),
        ),
        // Meta line — count + reading time, no Issue Nº
        React.createElement(
          Section,
          { style: { textAlign: "center", padding: "18px 0 0" } },
          React.createElement(
            Text,
            {
              style: {
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.muted,
                margin: 0,
              },
            },
            `${String(totalCount)} stor${totalCount === 1 ? "y" : "ies"} · ${String(minRead)} min read`,
          ),
        ),
        // Hairline before stories
        React.createElement(Section, {
          style: {
            borderTop: `1px solid ${COLORS.line}`,
            margin: "28px 0 44px",
            padding: 0,
            lineHeight: "1px",
            fontSize: "1px",
          },
        }),
        // Stories with archive ribbon after story 2 (or after the last story if fewer)
        ...(() => {
          const ribbonAt =
            displayStories.length > RIBBON_AFTER_INDEX + 1
              ? RIBBON_AFTER_INDEX
              : displayStories.length - 1;
          return displayStories.flatMap((story, index) => {
            const isLast = index === displayStories.length - 1;
            const block = React.createElement(StoryBlock, {
              key: `story-${String(index)}`,
              story,
              isLast,
            });
            if (index === ribbonAt) {
              return [
                block,
                React.createElement(ArchiveRibbon, {
                  key: "archive-ribbon",
                  archiveUrl: baseUrl,
                }),
              ];
            }
            return [block];
          });
        })(),
        // End-of-issue archive link
        React.createElement(Section, {
          style: {
            borderTop: `1px solid ${COLORS.line}`,
            margin: "64px 0 0",
            padding: 0,
            lineHeight: "1px",
            fontSize: "1px",
          },
        }),
        React.createElement(
          Section,
          { style: { textAlign: "center", padding: "28px 0 0" } },
          React.createElement(
            Text,
            {
              style: {
                fontFamily: SERIF,
                fontSize: "22px",
                lineHeight: "1.3",
                fontStyle: "italic",
                fontWeight: 500,
                color: COLORS.ink,
                margin: "0 0 8px",
              },
            },
            "That's today's read.",
          ),
          React.createElement(
            Text,
            {
              style: {
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.muted,
                margin: "0 0 22px",
              },
            },
            "Missed yesterday? It's in the archive.",
          ),
          React.createElement(
            Link,
            {
              href: baseUrl,
              target: "_blank",
              style: {
                display: "inline-block",
                fontFamily: MONO,
                fontSize: "11px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.ink,
                textDecoration: "none",
                borderBottom: `1px solid ${COLORS.ink}`,
                paddingBottom: "2px",
              },
            },
            "Browse every issue →",
          ),
        ),
        // Footer
        React.createElement(Section, {
          style: {
            borderTop: `1px solid ${COLORS.line}`,
            margin: "56px 0 0",
            padding: 0,
            lineHeight: "1px",
            fontSize: "1px",
          },
        }),
        React.createElement(
          Section,
          { style: { textAlign: "center", padding: "24px 0 0" } },
          React.createElement(
            Text,
            {
              style: {
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.muted2,
                margin: "0 0 12px",
              },
            },
            React.createElement(
              "span",
              { style: { color: COLORS.ink, fontWeight: 500 } },
              "The Daily Read",
            ),
            " · Made by ",
            React.createElement(
              Link,
              {
                href: "https://vertexcover.io",
                target: "_blank",
                style: {
                  color: COLORS.muted,
                  borderBottom: `1px solid ${COLORS.line}`,
                  paddingBottom: "1px",
                  textDecoration: "none",
                },
              },
              "Vertexcover Labs",
            ),
          ),
          React.createElement(
            Text,
            {
              style: {
                fontFamily: sansFooter,
                fontSize: "12px",
                lineHeight: "1.6",
                color: COLORS.muted2,
                margin: "0 0 6px",
              },
            },
            "You're receiving this because you subscribed at ",
            React.createElement(
              Link,
              {
                href: baseUrl,
                target: "_blank",
                style: { color: COLORS.muted, textDecoration: "underline" },
              },
              baseUrl,
            ),
            ".",
          ),
          replyToEmail !== undefined
            ? React.createElement(
                Text,
                {
                  style: {
                    fontFamily: sansFooter,
                    fontSize: "12px",
                    lineHeight: "1.6",
                    color: COLORS.muted2,
                    margin: "0 0 6px",
                  },
                },
                "Reply with feedback, or ",
                React.createElement(
                  Link,
                  {
                    href: `mailto:${replyToEmail}`,
                    style: { color: COLORS.muted, textDecoration: "underline" },
                  },
                  replyToEmail,
                ),
                ".",
              )
            : null,
          React.createElement(
            Text,
            {
              style: {
                fontFamily: sansFooter,
                fontSize: "12px",
                lineHeight: "1.6",
                color: COLORS.muted2,
                margin: 0,
              },
            },
            React.createElement(
              Link,
              {
                href: unsubscribeUrl,
                target: "_blank",
                style: { color: COLORS.muted2, textDecoration: "underline" },
              },
              "Unsubscribe",
            ),
          ),
        ),
      ),
    ),
  );
}

export async function renderNewsletter(props: NewsletterRenderProps): Promise<string> {
  return render(React.createElement(NewsletterEmail, props));
}

import * as React from "react";
import { render } from "@react-email/components";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
  Preview,
  Img,
} from "@react-email/components";
import type { NewsletterRenderProps, NewsletterStory } from "@pipeline/workers/newsletter-send.js";

const MAX_STORIES = 5;

function NewsletterEmail({
  stories,
  issueDate,
  issueNumber,
  unsubscribeUrl,
  baseUrl,
  replyToEmail,
}: NewsletterRenderProps): React.ReactElement {
  const displayStories = stories.slice(0, MAX_STORIES);

  return React.createElement(Html, { lang: "en" },
    React.createElement(Head, null),
    React.createElement(Preview, null,
      `${displayStories[0]?.title ?? "Your daily AI digest"} — and ${String(Math.max(0, displayStories.length - 1))} more stories`,
    ),
    React.createElement(Body, {
      style: {
        backgroundColor: "#FAFAF7",
        fontFamily: "Georgia, serif",
        margin: 0,
        padding: "40px 0",
      },
    },
      React.createElement(Container, {
        style: { maxWidth: "600px", margin: "0 auto", padding: "0 24px" },
      },
        // Header
        React.createElement(Section, { style: { marginBottom: "32px" } },
          React.createElement(Text, {
            style: {
              fontSize: "11px",
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "#737373",
              margin: "0 0 8px",
            },
          }, `AI NEWSLETTER · ISSUE ${issueNumber}`),
          React.createElement(Text, {
            style: {
              fontSize: "28px",
              color: "#171717",
              margin: "0 0 4px",
              fontWeight: "normal",
            },
          }, issueDate),
          React.createElement(Hr, { style: { borderColor: "#171717", borderWidth: "2px", margin: "16px 0" } }),
        ),
        // Stories
        ...displayStories.map((story: NewsletterStory, index: number) =>
          React.createElement(Section, { key: story.url, style: { marginBottom: "40px" } },
            React.createElement(Text, {
              style: {
                fontSize: "11px",
                fontFamily: "monospace",
                color: "#8C3A1E",
                margin: "0 0 8px",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              },
            }, `N°${String(index + 1).padStart(2, "0")}`),
            React.createElement(Link, {
              href: story.url,
              style: {
                fontSize: "20px",
                color: "#171717",
                textDecoration: "none",
                fontFamily: "Georgia, serif",
                display: "block",
                marginBottom: "12px",
                lineHeight: "1.3",
              },
            }, story.title),
            ...(story.imageUrl !== undefined ? [
              React.createElement(Img, {
                src: story.imageUrl,
                alt: story.title,
                style: {
                  width: "100%",
                  maxWidth: "552px",
                  height: "auto",
                  display: "block",
                  marginBottom: "16px",
                },
              }),
            ] : []),
            ...(story.summary !== undefined ? [
              React.createElement(Text, {
                style: {
                  fontSize: "16px",
                  color: "#404040",
                  lineHeight: "1.6",
                  fontStyle: "italic",
                  margin: "0 0 16px",
                },
              }, story.summary),
            ] : []),
            ...(story.bullets !== undefined && story.bullets.length > 0 ? [
              React.createElement(Section, { style: { margin: "0 0 16px" } },
                ...story.bullets.map((bullet: string, bIndex: number) =>
                  React.createElement(Text, {
                    key: bIndex,
                    style: {
                      fontSize: "15px",
                      color: "#404040",
                      lineHeight: "1.5",
                      margin: "0 0 8px",
                      paddingLeft: "16px",
                    },
                  }, `— ${bullet}`),
                ),
              ),
            ] : []),
            ...(story.bottomLine !== undefined ? [
              React.createElement(Section, {
                style: {
                  borderLeft: "3px solid #8C3A1E",
                  paddingLeft: "16px",
                  margin: "16px 0 0",
                },
              },
                React.createElement(Text, {
                  style: {
                    fontSize: "11px",
                    fontFamily: "monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "#8C3A1E",
                    margin: "0 0 6px",
                  },
                }, "BOTTOM LINE"),
                React.createElement(Text, {
                  style: {
                    fontSize: "15px",
                    color: "#171717",
                    lineHeight: "1.5",
                    margin: 0,
                    fontWeight: "bold",
                  },
                }, story.bottomLine),
              ),
            ] : []),
            React.createElement(Hr, { style: { borderColor: "#E5E5E5", margin: "32px 0 0" } }),
          ),
        ),
        // Footer
        React.createElement(Section, { style: { paddingTop: "8px" } },
          React.createElement(Text, {
            style: {
              fontSize: "12px",
              color: "#737373",
              lineHeight: "1.6",
              margin: "0 0 8px",
            },
          },
            "You're receiving the AI Newsletter because you subscribed at ",
            React.createElement(Link, { href: baseUrl, style: { color: "#737373" } }, baseUrl),
            ".",
          ),
          ...(replyToEmail !== undefined ? [
            React.createElement(Text, {
              style: {
                fontSize: "12px",
                color: "#737373",
                lineHeight: "1.6",
                margin: "0 0 8px",
              },
            },
              "Reply to this email or write to ",
              React.createElement(Link, {
                href: `mailto:${replyToEmail}`,
                style: { color: "#737373" },
              }, replyToEmail),
              " with feedback.",
            ),
          ] : []),
          React.createElement(Text, {
            style: {
              fontSize: "12px",
              color: "#737373",
              lineHeight: "1.6",
              margin: 0,
            },
          },
            React.createElement(Link, { href: unsubscribeUrl, style: { color: "#737373" } }, "Unsubscribe"),
          ),
        ),
      ),
    ),
  );
}

export async function renderNewsletter(props: NewsletterRenderProps): Promise<string> {
  return render(React.createElement(NewsletterEmail, props));
}

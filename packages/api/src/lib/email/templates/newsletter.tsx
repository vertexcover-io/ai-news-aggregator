import * as React from "react";
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

export interface NewsletterStory {
  title: string;
  url: string;
  summary?: string;
  bullets?: string[];
  bottomLine?: string;
  imageUrl?: string;
}

export interface NewsletterEmailProps {
  stories: NewsletterStory[];
  issueDate: string;
  issueNumber: number;
  unsubscribeUrl: string;
  baseUrl: string;
  replyToEmail?: string;
}

const MAX_STORIES = 5;

export function NewsletterEmail({
  stories,
  issueDate,
  issueNumber,
  unsubscribeUrl,
  baseUrl,
  replyToEmail,
}: NewsletterEmailProps): React.ReactElement {
  const displayStories = stories.slice(0, MAX_STORIES);

  return (
    <Html lang="en">
      <Head />
      <Preview>
        {displayStories[0]?.title ?? "Your daily AI digest"} — and{" "}
        {String(Math.max(0, displayStories.length - 1))} more stories
      </Preview>
      <Body
        style={{
          backgroundColor: "#FAFAF7",
          fontFamily: "Georgia, serif",
          margin: 0,
          padding: "40px 0",
        }}
      >
        <Container
          style={{ maxWidth: "600px", margin: "0 auto", padding: "0 24px" }}
        >
          {/* Header */}
          <Section style={{ marginBottom: "32px" }}>
            <Text
              style={{
                fontSize: "11px",
                fontFamily: "monospace",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                color: "#737373",
                margin: "0 0 8px",
              }}
            >
              AI NEWSLETTER · ISSUE {issueNumber}
            </Text>
            <Text
              style={{
                fontSize: "28px",
                color: "#171717",
                margin: "0 0 4px",
                fontWeight: "normal",
              }}
            >
              {issueDate}
            </Text>
            <Hr style={{ borderColor: "#171717", borderWidth: "2px", margin: "16px 0" }} />
          </Section>

          {/* Stories */}
          {displayStories.map((story, index) => (
            <Section key={story.url} style={{ marginBottom: "40px" }}>
              <Text
                style={{
                  fontSize: "11px",
                  fontFamily: "monospace",
                  color: "#8C3A1E",
                  margin: "0 0 8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                N°{String(index + 1).padStart(2, "0")}
              </Text>
              <Link
                href={story.url}
                style={{
                  fontSize: "20px",
                  color: "#171717",
                  textDecoration: "none",
                  fontFamily: "Georgia, serif",
                  display: "block",
                  marginBottom: "12px",
                  lineHeight: "1.3",
                }}
              >
                {story.title}
              </Link>

              {story.imageUrl !== undefined && (
                <Img
                  src={story.imageUrl}
                  alt={story.title}
                  style={{
                    width: "100%",
                    maxWidth: "552px",
                    height: "auto",
                    display: "block",
                    marginBottom: "16px",
                  }}
                />
              )}

              {story.summary !== undefined && (
                <Text
                  style={{
                    fontSize: "16px",
                    color: "#404040",
                    lineHeight: "1.6",
                    fontStyle: "italic",
                    margin: "0 0 16px",
                  }}
                >
                  {story.summary}
                </Text>
              )}

              {story.bullets !== undefined && story.bullets.length > 0 && (
                <Section style={{ margin: "0 0 16px" }}>
                  {story.bullets.map((bullet, bIndex) => (
                    <Text
                      key={bIndex}
                      style={{
                        fontSize: "15px",
                        color: "#404040",
                        lineHeight: "1.5",
                        margin: "0 0 8px",
                        paddingLeft: "16px",
                      }}
                    >
                      — {bullet}
                    </Text>
                  ))}
                </Section>
              )}

              {story.bottomLine !== undefined && (
                <Section
                  style={{
                    borderLeft: "3px solid #8C3A1E",
                    paddingLeft: "16px",
                    margin: "16px 0 0",
                  }}
                >
                  <Text
                    style={{
                      fontSize: "11px",
                      fontFamily: "monospace",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "#8C3A1E",
                      margin: "0 0 6px",
                    }}
                  >
                    BOTTOM LINE
                  </Text>
                  <Text
                    style={{
                      fontSize: "15px",
                      color: "#171717",
                      lineHeight: "1.5",
                      margin: 0,
                      fontWeight: "bold",
                    }}
                  >
                    {story.bottomLine}
                  </Text>
                </Section>
              )}

              <Hr style={{ borderColor: "#E5E5E5", margin: "32px 0 0" }} />
            </Section>
          ))}

          {/* Footer */}
          <Section style={{ paddingTop: "8px" }}>
            <Text
              style={{
                fontSize: "12px",
                color: "#737373",
                lineHeight: "1.6",
                margin: "0 0 8px",
              }}
            >
              You&apos;re receiving the AI Newsletter because you subscribed at{" "}
              <Link href={baseUrl} style={{ color: "#737373" }}>
                {baseUrl}
              </Link>
              .
            </Text>
            {replyToEmail !== undefined && (
              <Text
                style={{
                  fontSize: "12px",
                  color: "#737373",
                  lineHeight: "1.6",
                  margin: "0 0 8px",
                }}
              >
                Reply to this email or write to{" "}
                <Link
                  href={`mailto:${replyToEmail}`}
                  style={{ color: "#737373" }}
                >
                  {replyToEmail}
                </Link>{" "}
                with feedback.
              </Text>
            )}
            <Text
              style={{
                fontSize: "12px",
                color: "#737373",
                lineHeight: "1.6",
                margin: 0,
              }}
            >
              <Link href={unsubscribeUrl} style={{ color: "#737373" }}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

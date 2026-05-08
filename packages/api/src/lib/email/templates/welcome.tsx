import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Preview,
} from "@react-email/components";

export interface WelcomeEmailProps {
  baseUrl: string;
  unsubscribeUrl: string;
}

const COLORS = {
  bg: "#fbfaf7",
  bgElev: "#ffffff",
  ink: "#14110d",
  ink2: "#2a261f",
  muted: "#6b6557",
  muted2: "#8a8472",
  line: "#e7e2d6",
  rust: "#8c3a1e",
};

const SERIF = 'Newsreader, Georgia, "Times New Roman", serif';
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export function WelcomeEmail({
  baseUrl,
  unsubscribeUrl,
}: WelcomeEmailProps): React.ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        You&apos;re in. Tomorrow morning, your first issue. Here&apos;s what to expect.
      </Preview>
      <Body style={{ backgroundColor: COLORS.bg, margin: 0, padding: "56px 0 80px" }}>
        <Container style={{ maxWidth: "600px", margin: "0 auto", padding: "0 28px" }}>
          {/* Eyebrow — brand */}
          <Section style={{ textAlign: "center", padding: 0 }}>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: "11px",
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: COLORS.rust,
                margin: 0,
              }}
            >
              The Daily Read
            </Text>
          </Section>

          {/* Eyebrow — status */}
          <Section style={{ textAlign: "center", padding: "14px 0 0" }}>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: COLORS.muted,
                margin: 0,
              }}
            >
              You&apos;re in
            </Text>
          </Section>

          {/* Headline */}
          <Section style={{ textAlign: "center", padding: "32px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "42px",
                lineHeight: "1.05",
                fontWeight: 600,
                letterSpacing: "-0.014em",
                color: COLORS.ink,
                margin: 0,
              }}
            >
              Welcome to<br />The Daily Read.
            </Text>
          </Section>

          {/* Italic dek */}
          <Section style={{ textAlign: "center", padding: "22px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "18px",
                lineHeight: "1.55",
                fontStyle: "italic",
                color: COLORS.ink2,
                margin: "0 auto",
                maxWidth: "480px",
              }}
            >
              Subscription confirmed. Your first issue lands in your inbox tomorrow morning around
              7&thinsp;am — five stories, seven minutes, every weekday.
            </Text>
          </Section>

          {/* Hairline */}
          <Section
            style={{
              borderTop: `1px solid ${COLORS.line}`,
              margin: "44px 0 0",
              padding: 0,
              lineHeight: "1px",
              fontSize: "1px",
            }}
          />

          {/* Editor's note label */}
          <Section style={{ textAlign: "center", padding: "36px 0 0" }}>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: COLORS.rust,
                margin: 0,
              }}
            >
              From the editors
            </Text>
          </Section>

          {/* Editor's note card */}
          <Section style={{ padding: "22px 0 0" }}>
            <Section
              style={{
                backgroundColor: COLORS.bgElev,
                border: `1px solid ${COLORS.line}`,
                borderRadius: "8px",
                padding: "36px 36px 32px",
              }}
            >
              <Text
                style={{
                  fontFamily: SERIF,
                  fontSize: "19px",
                  lineHeight: "1.6",
                  fontStyle: "italic",
                  color: COLORS.ink,
                  margin: "0 0 20px",
                }}
              >
                We started The Daily Read because the AI firehose is loud and most of it doesn&apos;t
                matter. Five stories a day, every weekday — and a bottom line on each so you can
                skim the morning and still know what shipped.
              </Text>
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: "10.5px",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: COLORS.muted,
                  margin: 0,
                }}
              >
                — The Vertexcover Labs team
              </Text>
            </Section>
          </Section>

          {/* Sign-off */}
          <Section style={{ textAlign: "center", padding: "64px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "20px",
                lineHeight: "1.4",
                fontStyle: "italic",
                color: COLORS.ink,
                margin: 0,
              }}
            >
              Glad to have you.
            </Text>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.muted,
                margin: "8px 0 0",
              }}
            >
              — Vertexcover Labs
            </Text>
          </Section>

          {/* Footer hairline */}
          <Section
            style={{
              borderTop: `1px solid ${COLORS.line}`,
              margin: "44px 0 0",
              padding: 0,
              lineHeight: "1px",
              fontSize: "1px",
            }}
          />

          {/* Footer */}
          <Section style={{ textAlign: "center", padding: "22px 0 0" }}>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.muted2,
                margin: "0 0 12px",
              }}
            >
              <span style={{ color: COLORS.ink, fontWeight: 500 }}>The Daily Read</span>{" "}
              &nbsp;·&nbsp; Made by{" "}
              <Link
                href="https://vertexcover.io"
                target="_blank"
                style={{
                  color: COLORS.muted,
                  borderBottom: `1px solid ${COLORS.line}`,
                  paddingBottom: "1px",
                  textDecoration: "none",
                }}
              >
                Vertexcover Labs
              </Link>
            </Text>
            <Text
              style={{
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "1.6",
                color: COLORS.muted2,
                margin: "0 0 6px",
              }}
            >
              You&apos;re receiving this because you confirmed your subscription at{" "}
              <Link
                href={baseUrl}
                target="_blank"
                style={{ color: COLORS.muted, textDecoration: "underline" }}
              >
                {baseUrl}
              </Link>
              .
            </Text>
            <Text
              style={{
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "1.6",
                color: COLORS.muted2,
                margin: 0,
              }}
            >
              Changed your mind?{" "}
              <Link
                href={unsubscribeUrl}
                target="_blank"
                style={{ color: COLORS.muted2, textDecoration: "underline" }}
              >
                Unsubscribe
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

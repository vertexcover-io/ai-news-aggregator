import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Img,
  Preview,
} from "@react-email/components";

const LOGO_URL = "https://agentloop.vertexcover.io/agentloop-mark.png";

export interface FeedbackEmailProps {
  /** Parsed first name; falls back to a warm default when absent. */
  firstName?: string;
  loveUrl: string;
  mehUrl: string;
  nahUrl: string;
}

const COLORS = {
  bg: "#fbfaf7",
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

const OPTIONS: { url: (p: FeedbackEmailProps) => string; label: string }[] = [
  { url: (p) => p.loveUrl, label: "👍  Genuinely useful, keep it coming" },
  { url: (p) => p.mehUrl, label: "😐  It's fine, I skim it" },
  { url: (p) => p.nahUrl, label: "👎  Not really for me" },
];

export function FeedbackEmail(props: FeedbackEmailProps): React.ReactElement {
  const greetingName = props.firstName && props.firstName.trim() !== "" ? props.firstName : "there";

  return (
    <Html lang="en">
      <Head />
      <Preview>One tap tells us how AgentLoop is landing for you.</Preview>
      <Body style={{ backgroundColor: COLORS.bg, margin: 0, padding: "56px 0 80px" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "0 28px" }}>
          <Section style={{ textAlign: "center", padding: 0 }}>
            <Img
              src={LOGO_URL}
              width="44"
              height="44"
              alt="AgentLoop"
              style={{ display: "block", margin: "0 auto 12px", borderRadius: "10px" }}
            />
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
              AgentLoop
            </Text>
          </Section>

          <Section style={{ padding: "32px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "19px",
                lineHeight: "1.6",
                color: COLORS.ink2,
                margin: 0,
              }}
            >
              {`Hey ${greetingName},`}
            </Text>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "19px",
                lineHeight: "1.6",
                color: COLORS.ink2,
                margin: "18px 0 0",
              }}
            >
              You&apos;ve been getting the AgentLoop AI digest from us for a few weeks now, and we
              wanted to check in. We read every reply ourselves, so this goes straight to the people
              building it.
            </Text>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "19px",
                lineHeight: "1.6",
                color: COLORS.ink2,
                margin: "18px 0 0",
              }}
            >
              One tap, that&apos;s the whole ask. How&apos;s it landing for you?
            </Text>
          </Section>

          {/* Three one-tap options */}
          <Section style={{ padding: "28px 0 0" }}>
            {OPTIONS.map((opt) => (
              <Link
                key={opt.label}
                href={opt.url(props)}
                target="_blank"
                style={{
                  display: "block",
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: "10px",
                  padding: "15px 20px",
                  margin: "0 0 12px",
                  fontFamily: SANS,
                  fontSize: "16px",
                  color: COLORS.ink,
                  textDecoration: "none",
                  backgroundColor: "#ffffff",
                }}
              >
                {opt.label}
              </Link>
            ))}
          </Section>

          <Section style={{ padding: "16px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "17px",
                lineHeight: "1.6",
                color: COLORS.ink2,
                margin: 0,
              }}
            >
              And if anything&apos;s annoying you, like too long, wrong topics, lands at a bad time,
              or broken links, just <strong>hit reply</strong> and tell us. Even one line helps a lot.
            </Text>
          </Section>

          <Section style={{ padding: "40px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "18px",
                lineHeight: "1.55",
                fontStyle: "italic",
                color: COLORS.ink,
                margin: 0,
              }}
            >
              Thanks for reading,
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
              — The Vertexcover team
            </Text>
          </Section>

          <Section
            style={{
              borderTop: `1px solid ${COLORS.line}`,
              margin: "44px 0 0",
              padding: 0,
              lineHeight: "1px",
              fontSize: "1px",
            }}
          />
          <Section style={{ textAlign: "center", padding: "22px 0 0" }}>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: "10.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: COLORS.muted2,
                margin: 0,
              }}
            >
              <span style={{ color: COLORS.ink, fontWeight: 500 }}>AgentLoop</span> &nbsp;·&nbsp; Made
              by Vertexcover
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

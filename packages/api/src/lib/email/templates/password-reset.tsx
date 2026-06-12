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

export interface PasswordResetEmailProps {
  resetUrl: string;
}

const COLORS = {
  bg: "#fbfaf7",
  ink: "#14110d",
  muted: "#6b6557",
  line: "#e7e2d6",
  rust: "#8c3a1e",
};

const SERIF = 'Newsreader, Georgia, "Times New Roman", serif';
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export function PasswordResetEmail({
  resetUrl,
}: PasswordResetEmailProps): React.ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your password — this link expires in one hour.</Preview>
      <Body style={{ backgroundColor: COLORS.bg, margin: 0, padding: "56px 0 80px" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "0 28px" }}>
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
              Password Reset
            </Text>
          </Section>
          <Section style={{ textAlign: "center", padding: "24px 0 0" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "24px",
                color: COLORS.ink,
                margin: 0,
              }}
            >
              Set a new password
            </Text>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "15px",
                lineHeight: "24px",
                color: COLORS.muted,
                margin: "16px 0 0",
              }}
            >
              We received a request to reset the password for your account.
              This link is valid for one hour and can be used once.
            </Text>
          </Section>
          <Section style={{ textAlign: "center", padding: "28px 0 0" }}>
            <Link
              href={resetUrl}
              style={{
                display: "inline-block",
                fontFamily: MONO,
                fontSize: "13px",
                letterSpacing: "0.06em",
                color: COLORS.bg,
                backgroundColor: COLORS.rust,
                padding: "12px 28px",
                textDecoration: "none",
              }}
            >
              Reset password
            </Link>
          </Section>
          <Section style={{ textAlign: "center", padding: "28px 0 0", borderTop: `1px solid ${COLORS.line}`, marginTop: "32px" }}>
            <Text
              style={{
                fontFamily: SERIF,
                fontSize: "13px",
                color: COLORS.muted,
                margin: "16px 0 0",
              }}
            >
              If you did not request this, you can safely ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

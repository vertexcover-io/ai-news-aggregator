import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Button,
  Hr,
  Preview,
} from "@react-email/components";

interface ConfirmationEmailProps {
  confirmUrl: string;
  baseUrl: string;
}

export function ConfirmationEmail({ confirmUrl }: ConfirmationEmailProps): React.ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>Confirm your AI Newsletter subscription</Preview>
      <Body
        style={{
          backgroundColor: "#FAFAF7",
          fontFamily: "Georgia, serif",
          margin: 0,
          padding: "40px 0",
        }}
      >
        <Container
          style={{ maxWidth: "560px", margin: "0 auto", padding: "0 24px" }}
        >
          <Text
            style={{
              fontSize: "13px",
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#737373",
              marginBottom: "8px",
            }}
          >
            AI NEWSLETTER
          </Text>
          <Text
            style={{ fontSize: "24px", color: "#171717", margin: "0 0 24px" }}
          >
            Confirm your subscription
          </Text>
          <Text
            style={{ fontSize: "16px", color: "#404040", lineHeight: "1.6" }}
          >
            Click the button below to confirm your email and start receiving the
            daily AI digest.
          </Text>
          <Button
            href={confirmUrl}
            style={{
              backgroundColor: "#8C3A1E",
              color: "#FAFAF7",
              padding: "12px 24px",
              borderRadius: "4px",
              fontSize: "14px",
              fontFamily: "monospace",
              textDecoration: "none",
              display: "inline-block",
              margin: "24px 0",
            }}
          >
            Confirm subscription
          </Button>
          <Hr style={{ borderColor: "#E5E5E5", margin: "32px 0" }} />
          <Text style={{ fontSize: "13px", color: "#737373" }}>
            If you didn&apos;t subscribe to the AI Newsletter, you can safely
            ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

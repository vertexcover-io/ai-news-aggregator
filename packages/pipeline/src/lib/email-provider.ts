import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Resend } from "resend";
import { createTransport } from "nodemailer";
import type { EmailProvider, SendEmailParams, SendEmailResult } from "@newsletter/shared";
import type { SmtpConfig } from "@newsletter/shared/types/tenant";
import {
  EmailSendError,
  RETRYABLE_RESEND_CODES,
  parseRetryAfter,
} from "@newsletter/shared/types";

function createSesProvider(): EmailProvider {
  const client = new SESv2Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials:
      process.env.AWS_ACCESS_KEY_ID !== undefined
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
            ...(process.env.AWS_SESSION_TOKEN !== undefined
              ? { sessionToken: process.env.AWS_SESSION_TOKEN }
              : {}),
          }
        : undefined,
  });

  return {
    async send(params: SendEmailParams): Promise<SendEmailResult> {
      const customHeaders =
        params.headers !== undefined
          ? Object.entries(params.headers).map(([Name, Value]) => ({ Name, Value }))
          : [];

      const result = await client.send(
        new SendEmailCommand({
          FromEmailAddress: params.from,
          Destination: { ToAddresses: params.to },
          ReplyToAddresses: params.replyTo !== undefined ? [params.replyTo] : undefined,
          Content: {
            Simple: {
              Subject: { Data: params.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: params.html, Charset: "UTF-8" },
                Text: { Data: params.text, Charset: "UTF-8" },
              },
              Headers: customHeaders.length > 0 ? customHeaders : undefined,
            },
          },
        }),
      );

      return { messageId: result.MessageId ?? "" };
    },
  };
}

function createResendProvider(): EmailProvider {
  const client = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(params: SendEmailParams): Promise<SendEmailResult> {
      const result = await client.emails.send({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        replyTo: params.replyTo,
        headers: params.headers,
      });
      if (result.error !== null) {
        const code = result.error.name;
        throw new EmailSendError({
          code,
          message: `Resend error: ${result.error.message}`,
          retryAfterMs: parseRetryAfter(result.headers?.["retry-after"]),
          retryable: RETRYABLE_RESEND_CODES.has(code),
        });
      }
      return { messageId: result.data.id };
    },
  };
}

/**
 * Per-tenant SMTP provider (Fix #3, Phase B): bring-your-own email via the
 * universal SMTP path (SES/SendGrid/Postmark/Mailgun/etc.). The tenant owns
 * their domain auth (SPF/DKIM) with their provider — we only relay.
 */
export function createSmtpProvider(config: SmtpConfig): EmailProvider {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  });
  const from =
    config.fromName !== undefined && config.fromName.length > 0
      ? `${config.fromName} <${config.fromAddress}>`
      : config.fromAddress;
  return {
    async send(params: SendEmailParams): Promise<SendEmailResult> {
      const info = await transport.sendMail({
        from,
        to: params.to,
        replyTo: params.replyTo,
        subject: params.subject,
        html: params.html,
        text: params.text,
        headers: params.headers,
      });
      return { messageId: info.messageId };
    },
  };
}

export function createEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "ses"
    ? createSesProvider()
    : createResendProvider();
}

/**
 * Per-tenant SMTP provider + connection check (Fix #3, Phase B). Lets a tenant
 * bring any email provider (SES/SendGrid/Postmark/Mailgun/…) via the universal
 * SMTP path. The tenant owns their domain auth (SPF/DKIM) with their provider.
 */
import { createTransport } from "nodemailer";
import type { EmailProvider, SendEmailParams, SendEmailResult } from "@newsletter/shared";
import type { SmtpConfig } from "@newsletter/shared/types/tenant";

function fromHeader(config: SmtpConfig): string {
  return config.fromName !== undefined && config.fromName.length > 0
    ? `${config.fromName} <${config.fromAddress}>`
    : config.fromAddress;
}

export function createSmtpProvider(config: SmtpConfig): EmailProvider {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  });
  const from = fromHeader(config);
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

/**
 * Verifies the SMTP connection + credentials (nodemailer `verify()`), so a
 * tenant can't switch into `smtp` mode with creds that can't actually send
 * (design O-3). Throws on failure.
 */
export async function verifySmtpConnection(config: SmtpConfig): Promise<void> {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  });
  await transport.verify();
}

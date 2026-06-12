import { Resend } from "resend";
import type { EmailProvider, SendEmailParams, SendEmailResult } from "@newsletter/shared";

export function createResendProvider(): EmailProvider {
  // Lazy: the Resend constructor throws when the key is unset/blank, which
  // would make the whole API unbootable on keyless installs (fresh dev,
  // hermetic e2e). Without a key each send fails per-call instead and the
  // callers degrade (e.g. subscribe keeps the pending subscriber).
  const apiKey = process.env.RESEND_API_KEY;
  let client: Resend | null = null;
  return {
    async send(params: SendEmailParams): Promise<SendEmailResult> {
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is not configured — cannot send email");
      }
      client ??= new Resend(apiKey);
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
        throw new Error(`Resend error: ${result.error.message}`);
      }
      return { messageId: result.data.id };
    },
  };
}

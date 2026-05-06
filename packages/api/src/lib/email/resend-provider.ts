import { Resend } from "resend";
import type { EmailProvider, SendEmailParams, SendEmailResult } from "@newsletter/shared";

export function createResendProvider(): EmailProvider {
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
        throw new Error(`Resend error: ${result.error.message}`);
      }
      return { messageId: result.data.id };
    },
  };
}

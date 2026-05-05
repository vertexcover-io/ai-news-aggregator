import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Resend } from "resend";
import type { EmailProvider, SendEmailParams, SendEmailResult } from "@newsletter/shared";

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
        throw new Error(`Resend error: ${result.error.message}`);
      }
      return { messageId: result.data.id };
    },
  };
}

export function createEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "ses"
    ? createSesProvider()
    : createResendProvider();
}

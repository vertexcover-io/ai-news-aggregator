import { createSesProvider } from "./ses-provider.js";
import { createResendProvider } from "./resend-provider.js";
import type { EmailProvider, SendEmailParams, SendEmailResult } from "@newsletter/shared";

export type { EmailProvider, SendEmailParams, SendEmailResult };

export function createEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "ses"
    ? createSesProvider()
    : createResendProvider();
}

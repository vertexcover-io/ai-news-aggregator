import { createSesProvider } from "./ses-provider.js";
import { createResendProvider } from "./resend-provider.js";
import type { EmailProvider } from "@newsletter/shared";

export function createEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "ses"
    ? createSesProvider()
    : createResendProvider();
}

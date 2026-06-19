/**
 * Plain transactional email channel for tenant notifications (P16,
 * REQ-090/091). Sends from the SHARED platform sender (F38: transactional
 * mail — confirmations, resets, notifications — always uses the platform
 * address; only the digest broadcast requires the tenant's verified domain).
 *
 * `send` PROPAGATES failures — callers decide whether a failure blocks an
 * idempotency marker (review-ready: yes, D-107) or is merely logged
 * (error alerts: markerless).
 */
import type { EmailProvider } from "@newsletter/shared";
import { createEmailProvider } from "@pipeline/lib/email-provider.js";

export interface NotificationEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface NotificationEmailSender {
  send(input: NotificationEmailInput): Promise<void>;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createNotificationEmailSender(deps?: {
  provider?: EmailProvider;
  from?: string;
}): NotificationEmailSender {
  let provider = deps?.provider;
  const from =
    deps?.from ?? process.env.FROM_MAIL ?? "newsletter@news.vertexcover.io";
  return {
    async send(input: NotificationEmailInput): Promise<void> {
      // Lazily constructed so building deps never requires email env vars
      // when no tenant has an email channel configured.
      provider ??= createEmailProvider();
      await provider.send({
        to: [input.to],
        from,
        subject: input.subject,
        text: input.text,
        html: `<p>${escapeHtml(input.text).replaceAll("\n", "<br>")}</p>`,
      });
    },
  };
}

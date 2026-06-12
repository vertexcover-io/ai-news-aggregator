import * as React from "react";
import { render } from "@react-email/components";
import { ConfirmationEmail } from "./confirmation.js";
import { NewsletterEmail } from "./newsletter.js";
import { WelcomeEmail } from "./welcome.js";
import { FeedbackEmail } from "./feedback.js";
import { PasswordResetEmail } from "./password-reset.js";
import type { NewsletterEmailProps } from "./newsletter.js";
import type { WelcomeEmailProps } from "./welcome.js";
import type { FeedbackEmailProps } from "./feedback.js";
import type { PasswordResetEmailProps } from "./password-reset.js";

export type { EmailBranding, NewsletterEmailProps, NewsletterStory } from "./newsletter.js";
export type { WelcomeEmailProps } from "./welcome.js";
export type { FeedbackEmailProps } from "./feedback.js";
export type { PasswordResetEmailProps } from "./password-reset.js";

interface ConfirmationProps {
  confirmUrl: string;
  baseUrl: string;
}

export async function renderConfirmation(props: ConfirmationProps): Promise<string> {
  return render(React.createElement(ConfirmationEmail, props));
}

export async function renderNewsletter(props: NewsletterEmailProps): Promise<string> {
  return render(React.createElement(NewsletterEmail, props));
}

export async function renderWelcome(props: WelcomeEmailProps): Promise<string> {
  return render(React.createElement(WelcomeEmail, props));
}

export async function renderFeedback(props: FeedbackEmailProps): Promise<string> {
  return render(React.createElement(FeedbackEmail, props));
}

export async function renderPasswordReset(props: PasswordResetEmailProps): Promise<string> {
  return render(React.createElement(PasswordResetEmail, props));
}

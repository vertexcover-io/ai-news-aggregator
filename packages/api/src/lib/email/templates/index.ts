import * as React from "react";
import { render } from "@react-email/components";
import { ConfirmationEmail } from "./confirmation.js";
import { NewsletterEmail } from "./newsletter.js";
import type { NewsletterEmailProps } from "./newsletter.js";

export type { NewsletterEmailProps, NewsletterStory } from "./newsletter.js";

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

import { sectionMarkdown } from "./_helpers.js";

export function buildSubscriberRemovedMessage(input: {
  readonly email: string;
  readonly via: "unsubscribe-link" | "one-click" | "bounce" | "complaint";
  readonly totalConfirmed: number;
}): { blocks: unknown[] } {
  const text = `:red_circle: Subscriber removed: ${input.email}  (via ${input.via})  (#${input.totalConfirmed} total)`;
  return { blocks: [sectionMarkdown(text)] };
}

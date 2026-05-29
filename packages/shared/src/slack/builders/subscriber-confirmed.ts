import { sectionMarkdown } from "./_helpers.js";

export function buildSubscriberConfirmedMessage(input: {
  readonly email: string;
  readonly totalConfirmed: number;
}): { blocks: unknown[] } {
  const text = `:green_circle: New subscriber confirmed: ${input.email}  (#${input.totalConfirmed} total)`;
  return { blocks: [sectionMarkdown(text)] };
}

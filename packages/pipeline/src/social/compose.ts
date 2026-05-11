export interface ComposeInput {
  digestHeadline: string | null;
  digestSummary: string | null;
  archiveUrl: string;
}

export interface ComposedPosts {
  linkedinText: string;
  twitterText: string;
}

export const TWITTER_MAX_CHARS = 280;
export const TWITTER_URL_LENGTH = 23;

const SEPARATOR = "\n\n";
const TWITTER_TEXT_BUDGET =
  TWITTER_MAX_CHARS - (TWITTER_URL_LENGTH + SEPARATOR.length);

function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function buildBody(headline: string, summary: string | null, url: string): string {
  if (summary === null) return `${headline}${SEPARATOR}${url}`;
  return `${headline}${SEPARATOR}${summary}${SEPARATOR}${url}`;
}

export function composePosts(input: ComposeInput): ComposedPosts | null {
  const headline = normalize(input.digestHeadline);
  if (headline === null) return null;

  const summary = normalize(input.digestSummary);
  const url = input.archiveUrl;

  const linkedinText = buildBody(headline, summary, url);

  const fullTextLen =
    headline.length +
    (summary === null ? 0 : SEPARATOR.length + summary.length);

  let twitterText: string;
  if (fullTextLen <= TWITTER_TEXT_BUDGET) {
    twitterText = buildBody(headline, summary, url);
  } else if (summary !== null && headline.length + SEPARATOR.length + 1 <= TWITTER_TEXT_BUDGET) {
    // REQ-013: truncate summary first so we keep some of it.
    const summaryBudget = TWITTER_TEXT_BUDGET - headline.length - SEPARATOR.length;
    const truncatedSummary = `${summary.slice(0, summaryBudget - 1)}…`;
    twitterText = buildBody(headline, truncatedSummary, url);
  } else if (headline.length <= TWITTER_TEXT_BUDGET) {
    twitterText = buildBody(headline, null, url);
  } else {
    const truncatedHeadline = `${headline.slice(0, TWITTER_TEXT_BUDGET - 1)}…`;
    twitterText = buildBody(truncatedHeadline, null, url);
  }

  return { linkedinText, twitterText };
}

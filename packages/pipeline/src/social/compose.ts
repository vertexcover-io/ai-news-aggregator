export interface RankedStory {
  title: string;
  summary?: string;
}

export interface ComposeInput {
  heading?: string | null;
  hook: string | null;
  twitterSummary?: string | null;
  twitterIsPremium?: boolean;
  stories: RankedStory[];
  archiveUrl: string;
}

export type TwitterComposeResult =
  | { ok: true; text: string }
  | { ok: false; reason: "free_plan_over_limit"; text: string };

export interface ComposedPosts {
  linkedinText: string | null;
  twitter: TwitterComposeResult;
}

export const TWITTER_MAX_CHARS = 280;
export const TWITTER_URL_CHARS = 23;
export const TWITTER_SUMMARY_MAX_CHARS =
  TWITTER_MAX_CHARS - "Full breakdown ↓".length - TWITTER_URL_CHARS - 2;

const TWITTER_CTA = "Full breakdown ↓";
const TWITTER_STORY_PREFIX = "→ ";
const TWITTER_MAX_PREMIUM_STORIES = 3;
const TWITTER_LEAD_STORY_COUNT = 1;
const URL_RE = /https?:\/\/\S+/g;

function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function buildLinkedinStoryLine(index: number, story: RankedStory): string {
  return `${String(index)}) ${story.title}\n   ${story.summary ?? ""}`;
}

function buildLinkedin(
  hook: string,
  stories: RankedStory[],
  archiveUrl: string,
): string {
  const parts: string[] = [hook];
  for (let i = 0; i < stories.length; i += 1) {
    parts.push(buildLinkedinStoryLine(i + 1, stories[i]));
  }
  parts.push(`Full breakdown: ${archiveUrl}`);
  return parts.join("\n\n");
}

function buildTwitterText(
  heading: string | null,
  summary: string,
  stories: RankedStory[],
  archiveUrl: string,
  premium: boolean,
): string {
  if (!premium) return [summary, TWITTER_CTA, archiveUrl].join("\n");
  const storyLines = stories
    .map((story) => story.title.trim())
    .filter((title) => title !== "")
    .slice(
      TWITTER_LEAD_STORY_COUNT,
      TWITTER_LEAD_STORY_COUNT + TWITTER_MAX_PREMIUM_STORIES,
    )
    .map((title) => `${TWITTER_STORY_PREFIX}${title}`);
  const alsoInside = storyLines.length === 0
    ? []
    : [["Also inside:", ...storyLines].join("\n")];
  return [
    ...(heading === null ? [] : [heading]),
    summary,
    ...alsoInside,
    [TWITTER_CTA, archiveUrl].join("\n"),
  ].join("\n\n");
}

function countChars(value: string): number {
  return Array.from(value).length;
}

export function twitterWeightedLength(value: string): number {
  let length = 0;
  let cursor = 0;
  for (const match of value.matchAll(URL_RE)) {
    const index = match.index;
    length += countChars(value.slice(cursor, index));
    length += TWITTER_URL_CHARS;
    cursor = index + match[0].length;
  }
  return length + countChars(value.slice(cursor));
}

export function composePosts(input: ComposeInput): ComposedPosts | null {
  const hook = normalize(input.hook);
  const twitterSummary = normalize(input.twitterSummary ?? null) ?? hook;
  if (hook === null && twitterSummary === null) return null;
  const heading = normalize(input.heading ?? null);
  const premium = input.twitterIsPremium ?? false;

  const stories = input.stories.filter(
    (s) => s.title.trim() !== "" && (s.summary ?? "").trim() !== "",
  );
  const twitterStories = input.stories.filter((s) => s.title.trim() !== "");
  const twitterText = buildTwitterText(
    heading,
    twitterSummary ?? "",
    twitterStories,
    input.archiveUrl,
    premium,
  );
  const twitter =
    !premium && twitterWeightedLength(twitterText) > TWITTER_MAX_CHARS
      ? ({ ok: false, reason: "free_plan_over_limit", text: twitterText } as const)
      : ({ ok: true, text: twitterText } as const);

  return {
    linkedinText:
      hook === null ? null : buildLinkedin(hook, stories, input.archiveUrl),
    twitter,
  };
}

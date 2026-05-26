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

// "Full breakdown ↓" lives at the bottom of the body to point readers at the
// follow-up reply where the archive URL is posted (the body never contains a
// link itself — outbound links in the body penalise reach on X/LinkedIn).
const TEASER_CTA = "Full breakdown ↓";
const TEASER_SUFFIX = `\n\n${TEASER_CTA}`;

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
  return `${String(index)}) ${story.summary ?? ""}`;
}

function buildLinkedin(hook: string, stories: RankedStory[]): string {
  const parts: string[] = [hook];
  for (let i = 0; i < stories.length; i += 1) {
    parts.push(buildLinkedinStoryLine(i + 1, stories[i]));
  }
  parts.push(TEASER_CTA);
  return parts.join("\n\n");
}

function buildTwitterText(
  heading: string | null,
  summary: string,
  stories: RankedStory[],
  premium: boolean,
): string {
  if (!premium) return `${summary}${TEASER_SUFFIX}`;
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
    TEASER_CTA,
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
    premium,
  );
  const twitter =
    !premium && twitterWeightedLength(twitterText) > TWITTER_MAX_CHARS
      ? ({ ok: false, reason: "free_plan_over_limit", text: twitterText } as const)
      : ({ ok: true, text: twitterText } as const);

  return {
    linkedinText: hook === null ? null : buildLinkedin(hook, stories),
    twitter,
  };
}

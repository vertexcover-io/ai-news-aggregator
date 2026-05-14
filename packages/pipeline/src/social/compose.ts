export interface RankedStory {
  title: string;
  summary: string;
}

export interface ComposeInput {
  hook: string | null;
  stories: RankedStory[];
  archiveUrl: string;
}

export interface ComposedPosts {
  linkedinText: string;
  twitterThread: string[];
}

export const TWITTER_MAX_CHARS = 280;

const ELLIPSIS = "…";

function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return ELLIPSIS;
  return `${text.slice(0, maxChars - 1)}${ELLIPSIS}`;
}

function buildLinkedinStoryLine(index: number, story: RankedStory): string {
  return `${String(index)}) ${story.title}\n   ${story.summary}`;
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

function buildTwitterStoryTweet(index: number, story: RankedStory): string {
  const prefix = `${String(index)}) ${story.title}\n`;
  const remaining = TWITTER_MAX_CHARS - prefix.length;
  if (remaining <= 0) {
    return truncateToChars(`${String(index)}) ${story.title}`, TWITTER_MAX_CHARS);
  }
  const summary = truncateToChars(story.summary, remaining);
  return `${prefix}${summary}`;
}

function buildTwitterThread(
  hook: string,
  stories: RankedStory[],
  archiveUrl: string,
): string[] {
  const thread: string[] = [hook];
  for (let i = 0; i < stories.length; i += 1) {
    thread.push(buildTwitterStoryTweet(i + 1, stories[i]));
  }
  thread.push(`Full breakdown: ${archiveUrl}`);
  return thread;
}

export function composePosts(input: ComposeInput): ComposedPosts | null {
  const hook = normalize(input.hook);
  if (hook === null) return null;

  const stories = input.stories.filter(
    (s) => s.title.trim() !== "" && s.summary.trim() !== "",
  );

  return {
    linkedinText: buildLinkedin(hook, stories, input.archiveUrl),
    twitterThread: buildTwitterThread(hook, stories, input.archiveUrl),
  };
}

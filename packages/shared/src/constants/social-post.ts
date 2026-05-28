// LinkedIn auto-post formatting constants. Shared between the pipeline composer
// (packages/pipeline/src/social/compose.ts) and the review-page preview
// (packages/web/src/components/review/DigestMetaPanel.tsx) so both render the
// same body byte-for-byte.

export const DEFAULT_LINKEDIN_HOOK = "AgentLoop — Today in Agentic Engineering";
export const LINKEDIN_MAX_STORIES = 5;
export const LINKEDIN_BULLET_PREFIX = "→ ";
export const LINKEDIN_FOOTER = "Full newsletter linked in the comments.";

export interface LinkedinPreviewStory {
  summary?: string | null;
}

export function buildLinkedinPostBody(
  hook: string | null | undefined,
  stories: readonly LinkedinPreviewStory[],
): string {
  const header =
    typeof hook === "string" && hook.trim() !== ""
      ? hook.trim()
      : DEFAULT_LINKEDIN_HOOK;
  const bullets: string[] = [];
  for (const story of stories) {
    if (bullets.length >= LINKEDIN_MAX_STORIES) break;
    const summary = (story.summary ?? "").trim();
    if (summary === "") continue;
    bullets.push(`${LINKEDIN_BULLET_PREFIX}${summary}`);
  }
  return [header, ...bullets, LINKEDIN_FOOTER].join("\n\n");
}

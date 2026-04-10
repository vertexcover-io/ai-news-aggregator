import type { UserProfile } from "@newsletter/shared";

export const SOURCE_NEUTRALITY_RULE =
  "Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement.";

export const RANK_SYSTEM_PROMPT_PROFILED = `You are ranking news items for a specific reader based on their profile.

Score each item 1-5 on each of the four axes below. Relevance is the gating axis: a very low Relevance score should constrain the overall quality of the item regardless of how strong the other axes are.

Scoring axes (1=very weak, 5=excellent):
- Relevance — how well the item aligns with the reader's declared topics and avoids their anti-topics. This is the gating axis; if an item is off-topic for this reader, Relevance must be scored low even when the other axes are strong.
- Novelty — whether the item reports new results, ideas, tools, or perspectives rather than recycled material.
- Signal-vs-hype — whether the item is substantive, concrete, and evidence-backed rather than marketing, speculation, recaps, or listicles.
- Actionability — whether a reader can do something with the item: use it, learn from it, apply it, or make a decision.

Source neutrality rule: ${SOURCE_NEUTRALITY_RULE}

Each rationale must name the driving axis (for example, "strong relevance — matches the reader's declared topic") so the reader can see which axis moved the score most.

Return a ranked array and use the \`id\` field from the input verbatim.
`;

export const RANK_SYSTEM_PROMPT_NO_PROFILE = `You are ranking news items for a general technical audience, without a specific reader profile.

Score each item 1-5 on each of the three axes below (1=very weak, 5=excellent):
- Novelty — new results, architectures, benchmarks, tools, or ideas. Score low for recaps and rehashed material.
- Signal-vs-hype — concrete, substantive content over PR, funding news, speculation, or listicles.
- Actionability — whether an engineer can do something with the item: build on it, apply it, or make a decision.

Source neutrality rule: ${SOURCE_NEUTRALITY_RULE}

Each rationale must name the driving axis so the reader can see why the item was ranked where it was.

Return a ranked array and use the \`id\` field from the input verbatim.
`;

export function composeProfiledPrompt(profile: UserProfile): string {
  const topics = profile.topics.join(", ");
  const antiTopics =
    profile.antiTopics && profile.antiTopics.length > 0
      ? profile.antiTopics.join(", ")
      : "(none)";
  return `${RANK_SYSTEM_PROMPT_PROFILED}
Reader profile:
- Name: ${profile.name}
- Topics: ${topics}
- Anti-topics: ${antiTopics}
`;
}

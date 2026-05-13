export const SOURCE_NEUTRALITY_RULE =
  "Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement.";

export const RANK_SYSTEM_PROMPT_NO_PROFILE = `The reader is an AI practitioner who opens this digest to find out what happened in the AI world today. They want to feel the pulse of the field — frontier labs shipping new models and research, the companies and people shaping where AI is going, the papers and ideas that change how practitioners think, the hardware and infrastructure that the field runs on, the industry moves that matter. The stories that excite them are the ones a friend who works in AI would text them about: "did you see what DeepMind / OpenAI / Anthropic / Meta just dropped?", "this new paper is wild", "this changes how we build agents."

They are less moved by personal tinkering posts, individual hardware-tuning walkthroughs, or community Q&A — those are fine if there's nothing else, but they're not why this reader is here. The reader wants the digest to feel like the AI world talking, not like a homelab forum.

Rank with that reader in mind. Items that move the AI story forward, or that an AI practitioner would want to know happened today, should rise. Items that don't speak to that interest should fall, even if they're well-written or technically solid in a narrower sense.

Score each candidate 0-100 on four axes, all viewed through that reader's eyes:
- Novelty — does this introduce something genuinely new to the AI world: a new model, a new result, a new idea, a new piece of infrastructure, a shift in how the field thinks. Recaps and rehashes score low.
- Signal-vs-hype — is this a substantive development the reader would want to know happened, or marketing, speculation, listicles, or empty announcements dressed up as news.
- Actionability — does this give the reader something to take away: a decision to revisit, a trend to update on, a paper to read, a tool to try, a position to reconsider. The bar is "would an AI practitioner act on or remember this," not "could an engineer git-clone it tonight."
- Practical-utility — does this help an AI practitioner do their work better in the broad sense: understanding model capabilities, evaluating tools and hardware, navigating the industry, making sound technical decisions. Narrow personal-rig tuning scores low here unless the lesson generalizes.

Source neutrality rule: ${SOURCE_NEUTRALITY_RULE}

Each rationale must name the driving axis so the reader can see why the item was ranked where it was.

For each ranked item, also produce:
- title: A 4-to-7-word neutral newswire headline summarizing this story. Sentence case. Names the actor and the action (subject-verb-object). No clickbait, no questions, no colons-as-title-tropes, no editorial framing words like "quietly", "finally", or "doubles down". Aim for ~50 characters. Examples: "OpenAI ships GPT-5 with native tool use", "Anthropic raises $5B at $60B valuation", "Meta open-sources Llama 4 weights", "Google's Veo 3 lands on Vertex AI".
- summary: A 1-2 sentence plain-text news summary of what happened. No markdown links.
- bullets: 3-5 plain-text analysis points explaining why this matters and what it means. No markdown links.
- bottomLine: A single plain-text strategic takeaway sentence. No markdown links.

Also return a top-level \`digest\` object summarizing the day across all ranked items:
- digest.headline: A tight 6-8 word phrase capturing the day's overall theme. Plain text, no trailing punctuation, no source names, no rankings.
- digest.summary: One sentence describing the main stories in today's digest, written for a reader scanning a list of issues. Mention the substantive themes, not source names or item counts.

Return a \`digest\` object and a \`ranked\` array. Use the \`id\` field from the input verbatim for each ranked entry.
`;

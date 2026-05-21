export const RECAP_VOICE_BLOCK = `Before writing any output fields, internally draft our editorial take on this story: is it important, is it overhyped, is it derivative, does it move the field, who benefits, who is being sold to. Form this stance from the facts in the source — never echo the source author's framing or opinion. Then write bullets and bottomLine through that stance first.

Each story has three distinct editorial layers. Do not let them repeat each other:

- summary = ORIENT. State what happened. Fact-first. No analysis, no implications, no "why it matters".
- bullets = EXPLAIN. Give exactly 3 specific details that help the reader understand the story: numbers, names, product changes, constraints, evidence, caveats, timeline, or comparisons. Each bullet must add new information not already stated in the summary. Select the three facts most needed to make our editorial take defensible, framed in our voice. No generic analysis phrases like "this signals", "this means", "this highlights", "this underscores", or "marks a shift". Write bullets in our editorial voice, not the source author's.
- bottomLine = INTERPRET. Answer "so what?" for developers, AI teams, or the market. This is the only place for strategic meaning or implication. State our take directly and confidently. Write bottomLine in our editorial voice.

Before returning, check:
1. If summary and bottomLine could both answer "what happened?", rewrite bottomLine.
2. If a bullet merely rephrases the summary, replace it with a concrete detail.
3. If a bullet says why it matters instead of what detail matters, move that idea to bottomLine or delete it.

- title: A 4-to-7-word neutral newswire headline. Sentence case. Names the actor and the action (subject-verb-object). No clickbait, no questions, no colons-as-title-tropes, no editorial framing words like "quietly", "finally", or "doubles down". Aim for ~50 characters.
  Good: "OpenAI ships GPT-5 with native tool use"
  Good: "Anthropic raises $5B at $60B valuation"

- summary: One sentence stating WHAT happened. ≤25 words. Actor + action + object + important number/name if available. No analysis here; analysis goes in bottomLine. No markdown links.
  Good: "OpenAI released GPT-5 today with a 400K-token context window and native tool use."
  Bad: "OpenAI's release shows the race for agentic tooling is heating up."

- bullets: Exactly 3 short bullets, ≤15 words each, ~12 words average. Each bullet is a scannable FACT: metric, feature, date, product name, limitation, evidence, affected user, or comparison. Write bullets in our editorial voice, not the source author's framing. NOT a second summary in disguise. NOT analysis phrases like "this signals", "this means", "this highlights", "this underscores", or "marks a shift"; those go in bottomLine. If two bullets say similar things, cut one and find a stronger fact. No markdown links.
  Good: "Pricing held at $5/$15 per M tokens — half of Claude Opus, identical to Haiku 3.5."
  Good: "Tool-use is native; no JSON schema scaffolding required."
  Bad: "The release marks an important step forward for the company's AI strategy."

- bottomLine: One sentence, ≤25 words. The strategic so-what in our editorial voice. This is the only place analysis lives. No markdown links. Must be our take, not a paraphrase of the source's own conclusion.
  Good: "Coding-agent buyers no longer have a clean reason to default to GPT-5; Anthropic just made the pricing decision harder."
  Bad: "This is a major leap for Anthropic and shows the company's commitment to safety."

DO NOT:
- Begin with "The author argues", "They say", "According to <source>", or "<source author> writes"
- Lift descriptive adjectives the source uses about itself (e.g. if a vendor blog calls the release "revolutionary", do not repeat that word)
- Paraphrase the source's thesis when the source IS the protagonist (e.g. do not restate Anthropic's own positioning of its product as our conclusion)
- Treat the source's claims as our conclusion — they are inputs to our judgment
- Invent facts not in the source or invent comparisons the source did not make
- Use clickbait verbs in bullets or bottomLine: "quietly", "finally", "doubles down", "shocks"`;

export const SOURCE_NEUTRALITY_RULE =
  "Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement.";

// The system prompt is now stored per-installation in `user_settings.ranking_prompt`
// and is read on every pipeline job; see `DEFAULT_RANKING_PROMPT` in
// `@newsletter/shared/constants` for the seed value. The legacy export name is
// preserved as a re-export so existing tests and fixtures keep compiling.
export { DEFAULT_RANKING_PROMPT as RANK_SYSTEM_PROMPT_NO_PROFILE } from "@newsletter/shared/constants";

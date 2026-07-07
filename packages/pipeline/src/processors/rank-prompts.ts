export const RECAP_VOICE_BLOCK = `Before writing any output fields, internally draft our editorial take on this story: is it important, is it overhyped, is it derivative, does it move the field, who benefits, who is being sold to. Form this stance from the facts in the source — never echo the source author's framing or opinion. Then write bullets and bottomLine through that stance first.

Each story has three distinct editorial layers. Do not let them repeat each other:

- summary = ORIENT. State what happened. Fact-first. No analysis, no implications, no "why it matters".
- bullets = EXPLAIN. Give up to 3 specific details that help the reader understand the story: numbers, names, product changes, constraints, evidence, caveats, timeline, or comparisons. Each bullet states exactly one fact — never join two facts into one bullet with "and" or a semicolon just to fit the count. Each bullet must add new information not already stated in the summary. Select the facts most needed to make our editorial take defensible, framed in our voice. No generic analysis phrases like "this signals", "this means", "this highlights", "this underscores", or "marks a shift". Write bullets in our editorial voice, not the source author's.
- bottomLine = INTERPRET. Answer "so what?" for developers, AI teams, or the market. This is the only place for strategic meaning or implication. State our take directly and confidently. Write bottomLine in our editorial voice.

Worked example — all four fields together for one story (a mid-size funding round), so you can see how the layers build on each other without repeating:
  title: "Cohere raises $500M at $7B valuation"
  summary: "Cohere raised a $500M Series D led by Radical Ventures, valuing the company at $7B."
  bullets:
    - "Round brings total raised to $1.7B."
    - "Valuation is up from $5.5B a year ago on enterprise LLM demand, not a new product."
    - "Cohere still trails OpenAI and Anthropic on public benchmark leaderboards despite the raise."
  bottomLine: "This is a vote of confidence in enterprise distribution, not a sign Cohere has closed the model-quality gap."
  Notice: summary states only the transaction; each bullet adds a fact the summary didn't (prior total raised, valuation trajectory, competitive standing); bottomLine is the only place judgment appears, and it's a real claim rather than a restatement of "Cohere raised money."

Before returning, check:
1. If summary and bottomLine could both answer "what happened?", rewrite bottomLine.
2. If a bullet merely rephrases the summary, replace it with a concrete detail.
3. If a bullet says why it matters instead of what detail matters, move that idea to bottomLine or delete it.
4. Count the words in each bullet and run the halves test from the bullets rule above. If any bullet exceeds 15 words or fails the halves test, split it or cut the weaker fact — a short bullet that merges two facts is still wrong, not just a long one.
5. If the source signals this is a follow-up to earlier coverage, confirm bottomLine states the delta since that coverage, not the original story's stakes.
6. Count the words in title, summary, and bottomLine against their caps (7, 25, 25). If bottomLine is over 25, you are almost always running two claims together via an em dash, semicolon, or "not just X" contrast — keep the single strongest claim and cut the rest, don't just tighten the wording of both.

- title: A 4-to-7-word neutral newswire headline. Sentence case. Names the actor and the action (subject-verb-object). No clickbait, no questions, no colons-as-title-tropes, no editorial framing words like "quietly", "finally", or "doubles down". Aim for ~50 characters. Count the words before finalizing. If a multi-word product name (e.g. "Claude Opus 4.8") already eats half the budget, drop redundant qualifiers — name the model, not the model plus its parent brand, once the actor is already named — and use a one-word verb ("ships", "adds", "hits") to land at 7 words or under. Do not ship a title over the cap because the name was long.
  Good: "OpenAI ships GPT-5 with native tool use"
  Good: "Anthropic raises $5B at $60B valuation"
  Bad (8 words, redundant qualifier): "Anthropic ships Claude Opus 4.8 for agentic coding" — cut "Claude" now that Anthropic is already named: "Anthropic ships Opus 4.8 for agentic coding" (7 words).

- summary: One sentence stating WHAT happened. ≤25 words — count the words before finalizing, and if you're over, cut a clause rather than lengthening the sentence to include it. Actor + action + object + important number/name if available. No analysis here; analysis goes in bottomLine.
  Good: "OpenAI released GPT-5 today with a 400K-token context window and native tool use."
  Bad: "OpenAI's release shows the race for agentic tooling is heating up."

- bullets: Up to 3 short bullets, ≤15 words each — this is a hard cap, not a target. Count the words before finalizing and cut anything over. One fact per bullet: read each bullet split at its comma, dash, semicolon, or "and" — if both halves independently name a complete fact (their own number, name, date, or event), you've merged two facts into one slot. This applies regardless of which specific facts they are or which connector joined them — a number fused with a second number, a mechanism fused with its own performance stat, a total fused with what it's for, a timeline fused with an outcome, are all the same error. Split into two bullets or cut the weaker half; never rewrite the connector to disguise the merge. Each bullet is a scannable FACT: metric, feature, date, product name, limitation, evidence, affected user, or comparison. Write bullets in our editorial voice, not the source author's framing. NOT a second summary in disguise. NOT analysis phrases like "this signals", "this means", "this highlights", "this underscores", or "marks a shift"; those go in bottomLine. If two bullets say similar things, cut one and find a stronger fact.
  Good: "Pricing held at $5/$15 per M tokens — half of Claude Opus, identical to Haiku 3.5."
  Good: "Tool calls are native, with no JSON schema scaffolding required."
  Bad: "The release marks an important step forward for the company's AI strategy."
  Bad (two facts in one slot): a metric plus a second, unrelated metric or claim, joined by "and" or a semicolon just to fit both in — split into two bullets or keep only the stronger fact.

- bottomLine: One sentence, ≤25 words — count the words before finalizing, same discipline as bullets. The strategic so-what in our editorial voice. This is the only place analysis lives. Must be our take, not a paraphrase of the source's own conclusion. Pick ONE lens and let it carry the sentence: either name the specific detail that matters, or make the contrast/stakes claim — a sentence that does both ("detail X — Y, not just Z") is the single most common way this runs over 25 words. If the story is genuinely minor or the implications are unclear, say so plainly rather than manufacturing a stronger claim than the facts support — a flat, low-stakes assessment is a valid and often correct bottomLine.
  Good: "Coding-agent buyers no longer have a clean reason to default to GPT-5; Anthropic just made the pricing decision harder."
  Good: "This is a routine version bump with no material effect on the competitive landscape."
  Bad: "This is a major leap for Anthropic and shows the company's commitment to safety."
  Bad (28 words, detail + contrast stacked in one sentence): "Reflective rollout is the detail to watch — self-critiquing tool calls before execution is a concrete architectural bet on reducing agent failure modes, not just a benchmark bump." — pick one: name the detail and its stake, or make the contrast, not both.
  Good (same story, one lens, 14 words): "Reflective rollout, not the SWE-bench score, is the detail worth tracking as agent-reliability infrastructure."

Thin or missing content: if body is null, empty, or too short to support specific claims, do not invent details, numbers, or comparisons to fill the fields. Write summary from only what is actually stated (title, url, source metadata). For bullets, write only as many as there is distinct material for — state the missing-content limitation once, not three times in different words. One bullet is fine; zero bullets is fine if the summary already says everything available. Use bottomLine to note the limitation plainly instead of guessing at significance.
  Good bullets for this case (one distinct bullet, not padding): ["No further detail available beyond the headline."]
  Bad bullets for this case (same fact restated three ways): ["No details provided.", "Unable to assess scope or impact.", "Source body is empty."]
  Good bottomLine for this case: "Limited detail available beyond the headline; treat this as a heads-up rather than a fully reported story."

Technical depth: match the bullets' vocabulary and precision to the source's own register. If the source is developer- or research-facing (benchmarks, API changes, model internals, papers), use precise technical terms without re-explaining basics — assume the reader already knows what a context window or a benchmark is. If the source is consumer- or product-facing (an app feature, a UI change, mainstream coverage), avoid unexplained acronyms and insider jargon — plain-language a term the first time it appears instead of assuming familiarity. Do not simplify a technical story until it's vague, and do not jargon-load a consumer story to sound more technical than the source is.
  Good (technical source): "Uses speculative decoding with a 7B draft model; throughput gain is measured, not projected."
  Good (consumer source): "The edit tool lets you describe a change in plain English instead of using sliders or masks."
  Bad (jargon-loaded consumer story): "Leverages a diffusion-based latent inpainting pipeline for prompt-conditioned raster edits."

Follow-up stories: if the source itself signals this is a follow-up or incremental update to something already covered — phrases like "in response to", "following last week's", "an update to", "after backlash over", or a body that assumes the reader already knows the original event — write bottomLine around what is NEW since that prior coverage, not a restatement of the original story's stakes. Do not manufacture fresh urgency for what is actually a minor incremental restate of known news.
  Good: "The rollback itself is routine; the open question it leaves unanswered is why moderation missed this for three days."
  Bad: "This shows the platform's ongoing struggle to balance growth with safety." (restates the original story's stakes instead of addressing what's new)

Tone across valence: hold the same measured, evidence-first register whether the story is favorable (launch, funding, benchmark win) or unfavorable (lawsuit, security flaw, layoffs, public criticism). Do not turn promotional for good news or alarmist/gossipy for bad news — bottomLine's confidence should come from the strength of the evidence, not the story's emotional charge.
  Good (unfavorable story, measured): "The flaw affected a narrow auth path, not the full API; patch is already out, so this is a disclosure-hygiene story more than a security emergency."
  Bad (unfavorable story, alarmist): "This is a devastating blow that raises serious questions about whether the company can be trusted with user data at all."

DO NOT:
- Begin with "The author argues", "They say", "According to <source>", or "<source author> writes"
- Lift descriptive adjectives the source uses about itself (e.g. if a vendor blog calls the release "revolutionary", do not repeat that word)
- Paraphrase the source's thesis when the source IS the protagonist (e.g. do not restate Anthropic's own positioning of its product as our conclusion)
- Treat the source's claims as our conclusion — they are inputs to our judgment
- Invent facts not in the source or invent comparisons the source did not make
- Use clickbait verbs in bullets or bottomLine: "quietly", "finally", "doubles down", "shocks"
- Use markdown links in any field — plain text only, everywhere`;

export const SOURCE_NEUTRALITY_RULE =
  "Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement.";

// The system prompt is now stored per-installation in `user_settings.ranking_prompt`
// and is read on every pipeline job; see `DEFAULT_RANKING_PROMPT` in
// `@newsletter/shared/constants` for the seed value. The legacy export name is
// preserved as a re-export so existing tests and fixtures keep compiling.
export { DEFAULT_RANKING_PROMPT as RANK_SYSTEM_PROMPT_NO_PROFILE } from "@newsletter/shared/constants";

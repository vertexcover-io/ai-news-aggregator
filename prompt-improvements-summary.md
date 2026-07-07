# Recap Prompt Improvements

The "recap" step is what writes each newsletter item's title, one-line summary, 3 bullet points, and bottom-line takeaway. We tightened the instructions given to the AI model that writes these. Here's what changed and why it matters.

## Round 1

1. **Added a worked example** — the instructions used to give separate "good vs bad" snippets for each field in isolation. Now there's one full example (a funding-round story) showing title + summary + bullets + bottom line together, so the model can see how the pieces are supposed to fit without repeating each other.

2. **Thin/missing content guidance** — if a source article has little or no real content, the model previously had no explicit instruction and could start inventing plausible-sounding details. Now it's told to just say "not much info here" instead of making things up.

3. **Anti-hot-take guardrail** — for genuinely minor stories, the model was prone to manufacturing a punchy "this changes everything" takeaway. Now it's explicitly allowed (and encouraged) to say "this is minor, no big implications" when that's the truth.

4. **Cleaned up a repeated rule** — "no markdown links" was written three separate times in three different sections. Consolidated into one place.

5. **Follow-up fix: bullet length** — after the first round of changes, testing showed bullets sometimes ran way over the 15-word limit because the model was cramming two facts into one bullet with "and" or a semicolon. Added a hard rule: one fact per bullet, count your words, split or cut instead of merging.

6. **Follow-up fix: repetition on thin stories** — when there was little to say, the model was writing 3 bullets that all just restated "no info available" in different words. Now it's told to write only as many bullets as there's real distinct material for — one honest bullet beats three padded ones.

We tested all of this against real Claude API calls (not just re-reading the prompt) to confirm the behavior actually changed.

---

## Before / after: a thin story ("Acme Corp updates its blog theme")

This one has almost no real content behind it — a good stress test.

**Before:**
> Bullets:
> - No details provided beyond the headline.
> - Unable to assess scope, features, or user impact.
> - Source body is empty; treat as announcement-only.
>
> Bottom line: Insufficient detail to evaluate significance; this reads as a routine maintenance notice rather than a material product or business development.

**After:**
> Bullets:
> - No further detail available beyond the headline.
>
> Bottom line: Limited detail available; treat this as a heads-up rather than a fully reported story.

Same honesty about the lack of information, without padding it out to three near-identical bullets.

---

## Before / after: a minor story ("Startup X raises small seed round")

**Before:**
> Bullets:
> - No funding amount disclosed in announcement.
> - No investor names or round size provided.
> - No product details or use case specified.
>
> Bottom line: Insufficient detail to assess significance; treat as a heads-up rather than a fully reported story.

**After:**
> Bullets:
> - No funding amount, lead investor, or use of proceeds disclosed.
>
> Bottom line: Insufficient detail to assess the round's scale or strategic significance.

One clear bullet instead of three that all say "we don't know."

---

## Bonus: the bullet-length fix in action

On a normal, content-rich story (Anthropic's Claude Opus 4.8 release), the model previously merged two facts into one long bullet:

**Before (20+ words, two facts crammed together):**
> "Benchmarks show gains on SWE-bench-style tasks and multi-step tool orchestration; positioned as strongest model yet for autonomous software engineering agents."

**After (11 words, one clean fact):**
> "Benchmarks show gains on SWE-bench-style coding tasks and multi-step tool orchestration."

All bullets in the latest test run came in at 7–11 words, comfortably under the 15-word limit.

---

## Round 2

Three more improvements, plus a bug we caught along the way.

1. **Matching technical depth to the story** — for a deeply technical story (a new model technique, a benchmark result), the model now keeps the real technical terms instead of watering them down. For a consumer story (an app feature), it now avoids jargon and explains things in plain English instead. Before, there was no guidance on this, so technical stories sometimes got dumbed down and consumer stories sometimes got over-technical.

2. **Spotting "this is a follow-up" stories** — when a story is clearly a response or update to something already covered (a company issuing a statement after criticism, a patch following a bug report), the bottom line now focuses on what's actually new, instead of re-explaining the original story's whole backstory as if it were breaking news. Before, these follow-up stories could get treated like the news was happening for the first time.

3. **Same tone for good news and bad news** — whether a story is positive (a funding round, a product launch) or negative (a security issue, a lawsuit, public criticism), the model now writes with the same level, evidence-first tone either way. Before, nothing stopped it from sounding like a press release for good news, or sounding alarmed for bad news, regardless of how big a deal it actually was.

**The bug we caught along the way:** while testing round 2, we discovered that round 1's improvements never actually reached the real daily newsletter. It turns out there are two separate copies of these writing instructions in the codebase — one used only when someone manually adds a single article after the fact, and a completely separate copy that's actually used every day to generate the real newsletter. Round 1 only updated the first copy. So all of last round's fixes — the thin-content handling, the anti-hot-take fix, the bullet-length fix — were quietly not applying to the actual daily digest at all, only to that rare manual-add path.

We caught this because a safety check already built into the codebase (there specifically to make sure both copies always match) started failing once we looked closely. Rather than just silencing that check, we went and fixed the actual copy that runs every day, so both copies are back in sync. All of round 1's and round 2's improvements are now live in the real daily newsletter, not just the manual-add path.

---

## Round 2: examples

**Technical story stayed technical, consumer story stayed plain:**
> Technical story (a new AI speed-up technique): "71% of draft predictions were accepted across coding and general prompts."
> Consumer story (a photo app feature): "No subscription required — the feature is free for everyone starting this week."

**Follow-up story focused on what's new, not the original drama:**
> Story: a company responds to last week's criticism about how it handles location data, without actually changing anything.
> Bottom line: "This is just cleaner wording on a policy page — nothing about how the company actually handles data has changed."

**Bad news stayed measured instead of turning alarmist:**
> Story: a security flaw disclosed in an admin panel, narrow in scope, already patched.
> Bottom line: "Low risk for most users, but anyone running that specific setup should check they've applied the patch."

All three were tested against the real newsletter-writing process (the one that runs every day), not just the manual-add path — so we know these fixes actually show up in tomorrow's digest.

---

## Round 3

Two more improvements, aimed at making the "exactly 3 bullets" and "one fact per bullet" rules from earlier rounds actually stick.

1. **Bullets are a ceiling, not a quota** — the instructions used to say "exactly 3 bullets," which pushed the model to invent a third fact even when a story only supported one or two. Now it's "up to 3," so a well-covered story still gets 3 tight bullets, but a thin one can honestly get 1 or 2 without padding.

2. **A worked example showing all four fields together** — earlier rounds gave good/bad snippets for each field in isolation. Now there's one complete example (a mid-size funding round: title, summary, 3 bullets, bottom line) so the model can see how the pieces are meant to build on each other without repeating, in one place.

3. **Stronger anti-merging language for bullets** — testing kept turning up bullets that packed two facts into one using "and" or a semicolon (e.g. a benchmark score and a context-window size crammed into one bullet). The rule was tightened to spell out that this is wrong even when the merged bullet still reads smoothly and fits the word limit — the fix is to split it into two bullets or drop the weaker fact, not to compress harder.

4. **Cleaned up "no markdown links" for good** — this instruction had reappeared three times across different sections after earlier edits. Consolidated into the single do-not-do list.

**The bug we caught along the way:** while stress-testing round 3 against the real API, the semicolon-merging problem kept recurring specifically on funding-round stories — the model kept writing bullets like *"Total funding reaches $1.7B; capital earmarked for enterprise sales and infrastructure."* That's exactly the pattern the new rule was supposed to prevent. It turned out the worked example added in this same round had a semicolon-merged bullet baked into it (*"Round brings total raised to $1.7B; no new enterprise customers announced alongside it."*) — the "good" reference example was itself breaking the rule stated two paragraphs later, and the model was copying it. We fixed the example (trimmed it to one fact) and made the semicolon rule more concrete: it now spells out the exact failure pattern ("total raised" + "what it's for" is two facts, not one) and tells the model what to do the moment it's about to type a semicolon — delete everything after it, don't just reword it as "and".

After this fix, we re-tested against the real API across several runs: 1 semicolon-merged bullet out of 42 generated (~2%), down from roughly 1 in 4 items per run before the fix. That residual rate looks like normal model variance rather than a prompt gap, so we're treating it as an accepted limitation rather than continuing to chase zero.

---

## Round 3: examples

**Thin story gets fewer bullets instead of a manufactured third fact:**
> "PixelSnap adds one-tap background removal" (has exactly one real distinguishing detail):
> Bullets: ["Model trained on 10 million annotated images runs in under 200ms on a modern phone."]
> (One honest bullet — no invented second or third fact just to hit a count.)

**Before / after the worked-example bug fix (same funding-round story):**
> Before: "Round brings total raised to $1.7B; no new enterprise customers announced alongside it." (two facts merged via semicolon)
> After: "Round brings total raised to $1.7B." (one fact; the second fact either becomes its own bullet or is dropped)

**Merged bullet caught and split in real API testing (before the fix, on Anthropic's Opus 4.8 test story):**
> Before: "SWE-bench score rises from 69.1% to 74.2%; context window grows from 300K to 500K tokens."
> After (separate runs post-fix): "SWE-bench score rises from 69.1% to 74.2% over Opus 4.7." as its own bullet, with the context-window fact either dropped or given its own slot.

All of round 3's changes — including the worked-example fix — are synced across the same four places round 2 taught us to check (the manual-add prompt, the daily-run prompt, the DB seed migration, and the test fixture), and the automated drift check that catches future divergence between them stayed green throughout.

---

## Round 4

Widened the testing to check *every* stated rule at once (title length, summary length, bullet count/length, bottomLine length, the digest headline/summary/hook/tweet fields, and whether rationales cite a real scoring axis), instead of just the bullet-merging issue round 3 focused on. That wider net caught two systematic problems nothing had been checking for before.

1. **The tweet summary missed its length budget on the first try, every single time.** The code already retries once if `digest.twitterSummary` comes back too long, but across 6 separate real-API runs, the *first* attempt went over budget in all 6 — meaning every real newsletter run was quietly paying for two AI calls for this one field instead of one. The instructions said "it must fit" but gave the model no sense of how long that actually is in practice, and no self-check step. Added a concrete anchor ("~180 characters is about one sentence, one fact, two at most — don't stack three-plus numbers just because the source has them") and the same "count before finalizing, then cut the weaker fact" discipline that already worked well for bullets. Result: 0 over-budget first attempts across the next 12 test runs — the retry essentially stopped firing.

2. **The headline and the bottom-line take were quietly running over their word limits.** Two more things nothing had checked for until now:
   - **Titles**: the "4-to-7-word headline" rule doesn't leave enough room once a story's own product name is multi-word — e.g. "Anthropic ships Claude Opus 4.8 for agentic coding" is 8 words, and every test run produced something like it. Added guidance to drop redundant qualifiers once the company is already named (say "Opus 4.8," not "Claude Opus 4.8," once "Anthropic" is in the sentence) — this alone fixed the title-length problem in every subsequent test.
   - **Bottom line**: on richer stories, the model kept writing a bottom line that both named a specific technical detail *and* made a broader "not just X" contrast claim in the same sentence — a construction that reliably ran 27-36 words against a 25-word cap. Told the model to pick one lens (either the detail, or the contrast, not both), which brought this down to zero violations in testing.

---

## Round 5: what didn't work, and an important lesson about "Bad" examples

This round tried to fully close out the bullet-merging issue from round 3 (still showing up at a low rate) using increasingly specific fixes, and it's worth documenting honestly what happened, because the result was a real lesson rather than a clean win.

**What we tried, in order:**
- Naming the two most common story types where merging happens (funding rounds, security disclosures) explicitly in the instructions.
- Making the merge-detection rule fully generic (a "halves test": split the bullet at any connector, and if both halves independently state a complete fact, it's two facts, regardless of which specific facts they are).
- Removing several of the most detailed, fully-quoted "Bad" example sentences and replacing them with shorter, more abstract descriptions of the failure pattern.
- Consolidating the whole bullets rule, which had grown to roughly 230 words of accumulated caveats across three rounds, back down to a shorter, less repetitive version.

**What we found:** none of these moved the needle. Across five-run batches against the real API, the rate of bullets merging two facts into one (with a semicolon, or with "and") held steady at roughly 15-20%, consistently on the same handful of fact-dense stories (a security disclosure, a funding round, a consumer app announcement, a technical release) — regardless of which version of the instructions was in place at the time.

**A genuinely useful discovery along the way:** we caught direct evidence that the model will sometimes reproduce a "Bad" example from the instructions almost verbatim, despite it being explicitly labeled as wrong — including one test run that reproduced our own title "Bad" example word-for-word. This is a real, generalizable lesson for writing these prompts going forward: a fully-written, fluent, realistic "Bad" example sentence can act as a template the model copies, "Bad" label notwithstanding. The safer pattern is to describe the failure *category* abstractly (e.g. "a metric fused with a second, unrelated metric") rather than spelling out a complete, quotable bad sentence — which is now how the bullets and hook rules are written.

**Where this leaves things:** the test set used for this stress test was deliberately built to be fact-dense (deliberately packed with multiple distinct numbers/claims per story) specifically to surface this failure mode — real newsletter items are often thinner than this, so the true production rate is likely lower than what we measured here. Given 8 different phrasings of the same rule (explicit examples, generalized mechanism, categorical naming, abstraction, simplification) produced statistically indistinguishable results, this looks like a genuine limit of prompt-only steering for this specific behavior on this specific kind of dense story, not a gap we're one more sentence away from closing. Fully eliminating it would most likely need a deterministic code-level check after generation (e.g. flagging or auto-splitting any bullet containing a semicolon) rather than more prompt text — that's a code change, not a prompt change, so we're flagging it as a possible follow-up rather than doing it here.

We kept the simplified (shorter, less repetitive) version of the bullets rule over the more elaborate one, since it performed no worse and is easier to maintain.

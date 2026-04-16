# Iteration 2 Report

## Changes from Iteration 1
1. **Half-life: 48h -> 72h** — Slower recency decay so 30-36h old posts remain competitive
2. **Weights: 0.4/0.6 -> 0.5/0.5** — Equal engagement/recency blend
3. **Shortlist size: 20 -> 25** — More candidates for the LLM to evaluate

## Results

| Metric | Iteration 1 | Iteration 2 |
|--------|------------|------------|
| Candidates | 66 | 66 |
| Shortlisted | 20 | 25 |
| Reference items in shortlist | 4/6 (in DB) | 5/6 (in DB) |
| Reference items in top 10 | 4 | 2 |

## Comparison with Reference

| Ref# | Item | Iter 1 | Iter 2 |
|------|------|--------|--------|
| 2 | Audio processing llama-server | NOT shortlisted | Shortlisted (#22) but not ranked top 10 |
| 3 | Speculative Decoding Gemma 4 | NOT shortlisted | NOT shortlisted (35h old, id 724, scored ~0.72 vs cutoff ~0.725) |
| 4 | MiniMax M2.7 Licensing | Ranked #4 | Shortlisted (#7) but LLM dropped it from top 10 |
| 5 | MiniMax M2.7 GTA benchmark | Ranked #7 | Shortlisted (#11) but LLM dropped it from top 10 |
| 6 | Local models personal | Ranked #9 | Ranked #7 |
| 7 | RTX PRO 6000 build | Ranked #6 | Ranked #9 |

## What Improved
1. **Audio processing made the shortlist** — 72h half-life allowed a 32h-old post to survive
2. **Equal weights gave engagement more pull** — High-engagement reference items scored higher
3. **More shortlist slots** — 25 items gave more room for borderline candidates

## What's Still Wrong
1. **Speculative Decoding still misses** — At 36h old, it scores ~0.72 and just barely misses the 25-item cutoff. Need either more shortlist slots or gentler recency decay.
2. **LLM dropped reference items from top 10** — MiniMax licensing and GTA benchmark were shortlisted but Claude ranked them lower than new items (SNN, Qwen overthinking fix, etc.). This is actually fine — the LLM is making quality judgments, and the reference newsletter had different criteria.
3. **Shortlist-to-rank gap** — Items at positions 22-25 in the shortlist rarely make the final top 10 because the LLM scores them low. The shortlist needs to be selective enough that borderline items still have a chance.

## Root Cause: Shortlist vs LLM ranking divergence

The key insight from this iteration: **getting items INTO the shortlist is necessary but not sufficient**. The LLM independently evaluates quality, and items that make the shortlist on engagement alone (hardware builds, teaser posts) get ranked low by the LLM because they lack technical substance.

The reference newsletter seems to weigh "community interest + practical utility" more than our LLM prompt's "Novelty + Signal + Actionability" axes. The LLM correctly ranks an SNN research paper above a hardware build, but the reference newsletter valued hardware builds more.

## Proposed Changes for Iteration 3

1. **Increase shortlist to 30** (MAX_SHORTLIST_SIZE) — Ensure all borderline reference items get through
2. **Keep half-life at 72h** — This is working well
3. **Adjust LLM prompt** — Add a "Practical Utility" axis alongside Novelty/Signal/Actionability. This would score hardware guides, model comparisons, and practical tips higher (matching the reference newsletter's editorial direction)
4. **Keep weights at 0.5/0.5** — The balance is good

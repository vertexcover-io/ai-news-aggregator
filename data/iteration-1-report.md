# Iteration 1 Report

## Setup
- **Simulated date:** 2026-04-13 23:59 UTC (to match reference newsletter date)
- **Sources:** r/LocalLLaMA + r/localLLM, sort=top, timeframe=week
- **Candidates loaded:** 66 (published within 2 days of simulated date)
- **After dedup:** 66
- **Shortlisted:** 20 items
- **Ranked:** 10 items

## Comparison with Reference (smol.ai newsletter 2026-04-13)

| Ref# | Reference Item | Found? | Our Rank | Notes |
|------|---------------|--------|----------|-------|
| 1 | Best Local LLMs - Apr 2026 | NOT IN DB | - | Post not collected (possibly deleted or not in top/week) |
| 2 | Audio processing in llama-server with Gemma-4 | IN DB (id 716) but NOT shortlisted | - | 32h old, scored ~0.63 — below shortlist cutoff of ~0.71 |
| 3 | Speculative Decoding Gemma 4 31B | IN DB (id 724) but NOT shortlisted | - | 36h old, scored ~0.62 — below shortlist cutoff of ~0.71 |
| 4 | MiniMax M2.7 Licensing | YES | #4 | Good match |
| 5 | Local Minimax M2.7, GTA benchmark | YES | #7 | Good match |
| 6 | Local models personal matters | YES | #9 | Good match, ranked lower |
| 7 | NVIDIA RTX PRO 6000 build | YES | #6 | Good match |

**Hit rate: 4/7 reference items found (57%)**
**2 items in DB but excluded by shortlist, 1 item not in DB at all**

## What Went Right
1. **Engagement signal is working** — high-engagement posts like "Ryan Lee MiniMax" (421 pts) and "RTX PRO 6000" (437 pts) made it through
2. **Summary quality is good** — Claude's summaries are comparable in quality and detail to the smol.ai reference
3. **Bullet points capture the right insights** — technical details from comments are being surfaced
4. **Dynamic sizing worked** — 20 items selected from 66 candidates is reasonable

## What Went Wrong
1. **Recency still dominates too much** — Posts 32-36h old get a recency score of ~0.51, which drops their combined score below the cutoff even with decent engagement (300+ pts). The reference newsletter included these items.
2. **The 48h half-life is too aggressive for 2-day windows** — At 32h old, recency is already 0.51. At 36h, it's 0.47. These are perfectly relevant posts that are being penalized.
3. **Missing reference item**: "Best Local LLMs" was never collected — this is a collector gap, not a ranking issue.

## Root Cause Analysis

The scoring formula `0.4 * engagement + 0.6 * recency` with a 48h half-life means:
- At 12h: recency = 0.78, so a zero-engagement item scores 0.47
- At 24h: recency = 0.61, so a zero-engagement item scores 0.37
- At 36h: recency = 0.47, so even a max-engagement item can only score 0.4 + 0.28 = 0.68

When there are 20+ items under 12h old with decent engagement, anything over ~30h old gets squeezed out regardless of quality.

## Proposed Changes for Iteration 2

1. **Increase half-life to 72h** — This extends the recency window so 36h-old posts still score ~0.61 instead of ~0.47
2. **Reduce recency weight to 0.5** — Equal blend gives engagement more pull, so high-signal older posts can compete
3. **Increase shortlist size to 25** — More candidates means the LLM gets to evaluate border cases

These changes should recover the 2 missing reference items without degrading the rest of the shortlist.

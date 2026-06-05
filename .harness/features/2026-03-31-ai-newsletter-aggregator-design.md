# AI Newsletter Aggregator — Design Spec

> Personal-first AI news aggregator that scrapes multiple sources daily, processes them through an AI pipeline, and delivers a curated digest via email after human review.

---

## Goals

- Replace the habit of manually browsing HN, Twitter, Reddit for AI news
- Single daily digest with only high-quality, deduplicated, summarized content
- Human review ensures nothing low-quality gets through
- Personal use for Ritesh and Aman — no public subscribers for MVP

## Non-Goals (MVP)

- Public newsletter with subscription management
- Real-time or streaming updates
- Mobile app
- WhatsApp group integration (future consideration)
- Tech stack decisions (separate concern)
- Web archive and search (post-MVP)
- Admin settings web UI (post-MVP — use config file)
- Analytics and feedback loop tracking (post-MVP)

---

## MVP Scope

The MVP proves one thing: **can we use this daily?** Full end-to-end loop with minimal scope at each step.

| Layer | MVP | Post-MVP |
|---|---|---|
| **Collection** | 4 collectors, 7 sources (HN, 2 subreddits, 3 Twitter accounts, OpenAI blog) | Expand to 34+ sources |
| **Processing** | All 4 stages — dedup, filter, rank, summarize | Same |
| **Review** | `/review` page only (password-protected) | Add `/admin` settings page |
| **Admin config** | Config file (YAML/JSON) | Web UI (`/admin`) |
| **Email** | Scheduled send at configured time | Same |
| **Archive** | Not in MVP | `/archive` + `/digest/:date` pages |
| **Search** | Not in MVP | Full-text search across past digests |
| **Analytics** | Not in MVP | Approve/reject ratios, click-throughs, source quality tracking |

### MVP Sources

| Collector | Sources |
|---|---|
| `hn_collector` | HNRSS (JSON feed with keyword + points filters) |
| `reddit_collector` | r/MachineLearning, r/LocalLLaMA |
| `twitter_collector` | @_akhaliq, @karpathy, @simonw |
| `rss_collector` | OpenAI Blog |

---

## Architecture: Script-Based Pipeline

A set of independent scripts that run as a scheduled job. Each stage is a separate script: collect, deduplicate, filter, rank, summarize. A lightweight web app serves the review dashboard and archive. Email is sent via an API service.

Chosen over queue-based and all-in-one approaches for simplicity, debuggability, and speed to MVP.

---

## 1. Data Collection Layer

Runs once daily on a configurable schedule. Each collector is an independent script targeting one source type.

### Collectors

| Collector | Sources | Method |
|---|---|---|
| `hn_collector` | HNRSS.org | JSON feed with keyword + points filters |
| `reddit_collector` | 7 subreddits (r/MachineLearning, r/LocalLLaMA, r/artificial, r/OpenAI, r/AI_Agents, r/aiagents, r/generativeAI) | Reddit API or RSS fallback |
| `twitter_collector` | 9 accounts (@_akhaliq, @karpathy, @emollick, @simonw, @OpenAI, @AnthropicAI, @GoogleDeepMind, @HuggingFace, @rowancheung) | Twitter/X API or scraping fallback |
| `rss_collector` | 6 websites (HF Papers, The Decoder, Emergent Mind, MarkTechPost, Lobste.rs, Papers With Code) + 4 company blogs (OpenAI, Anthropic, Google DeepMind, Hugging Face) | RSS/Atom parsing |
| `github_collector` | Python trending (daily), llama.cpp releases, ollama releases | GitHub API or RSS |
| `producthunt_collector` | Product Hunt, Future Tools | API or RSS |

### Raw Item Schema

Each collected item is stored with:

- `source` — which collector produced it
- `source_url` — original link
- `title`
- `raw_content` — snippet or body text
- `published_at` — when the source published it
- `collected_at` — when we scraped it
- `engagement_signals` — upvotes, comments, retweets, etc. (source-specific)

### Error Handling

- If one collector fails (rate limit, downtime), others still run
- Failed collectors log errors and retry next cycle
- No items are lost — partial collection is acceptable

---

## 2. Processing Layer

Takes raw collected items and produces curated candidate items for human review. Four stages, run sequentially.

### Stage 1: Deduplication

Three passes, from simplest to smartest:

1. **URL normalization + exact match** — strip tracking params (`utm_*`, `ref`, `fbclid`), remove `www`, trailing slashes. Same canonical URL = same story, merge them.
2. **Title fuzzy match** — Jaccard similarity on tokenized titles, threshold 0.8. Catches "OpenAI launches GPT-5" vs "GPT-5 launched by OpenAI".
3. **Embedding-based semantic match** — use `all-MiniLM-L6-v2` (free, self-hosted). Cosine similarity threshold 0.85. Catches same story written completely differently.

When duplicates are found → merge into one item, keep all source links with engagement signals.

Output: deduplicated items, each with a `sources[]` array.

### Stage 1.5: Source-Type Tagging

After dedup, each item is tagged based on whether it has an external source or IS the source:

- **`has_external_source: true`** — the item points to an article, paper, or blog post (e.g., HN link to anthropic.com/blog, tweet with a link to a paper)
- **`has_external_source: false`** — the item IS the content itself (e.g., a @karpathy tweet sharing his own results, a Reddit self-post with original analysis)

This tag determines how summarization and email formatting work downstream.

### Stage 2: Filtering (Rule-Based, No LLM)

Deterministic rules applied in order. Same input = same output every time. Easy to test.

1. **Age cutoff** — reject items older than 36 hours (configurable)
2. **Engagement minimum per source** — HN: 30+ points, Reddit: 20+ upvotes, Twitter: 50+ likes
3. **Keyword blacklist** — reject titles containing: "hiring", "job posting", "check out my", "subscribe to my", "upvote if", "meme", etc.
4. **Low-signal content patterns** — reject titles matching: "is AI going to", "will AI replace", "what laptop should", "beginner question", "ELI5", etc.

No LLM in the filtering step. More items pass through to human review, but every filtering decision is deterministic and testable.

### Stage 3: Ranking

Heuristic scoring — no LLM needed:

- **Cross-source signal (highest weight)** — appears on 4 sources > appears on 1. Strongest quality indicator.
- **Engagement (normalized to percentiles)** — convert raw numbers to percentiles within each source type so HN points, Reddit upvotes, and Twitter likes are comparable.
- **Recency** — exponential time decay, newer items score higher.
- **Source authority** — pre-assigned weights per source. @karpathy tweet > random subreddit post.

Composite score = weighted sum. Items sorted by score, highest first.

### Stage 4: Summarization

LLM (Claude Sonnet or GPT-4o-mini) runs only on items that survived all previous stages.

**Process depends on source-type tag:**

| Case | What the LLM receives | What it produces |
|---|---|---|
| `has_external_source: true` | Full article text fetched from primary URL, extracted with Readability/Trafilatura, truncated to 3000 tokens | 2-3 sentence summary + "why it matters" + category tag |
| `has_external_source: false` + short content (tweet) | Tweet text + any linked content if available | Rewritten summary expanding on the tweet + "why it matters" + category tag |
| `has_external_source: false` + long content (Reddit self-post) | Post body text | 2-3 sentence summary + "why it matters" + category tag |

Category tags are assigned dynamically by the LLM based on content (e.g., "Research", "Product Launch", "Open Source", "Industry News", "Tool").

### Output

Candidate items stored in database with status `pending_review`, ready for human review.

**Email formatting also depends on source-type tag:**

| Case | Email format |
|---|---|
| `has_external_source: true` | Title links to primary source. "Discussed on:" shows HN/Reddit/Twitter links below. |
| `has_external_source: false` | Title links to the post/tweet itself. "Discussed on:" only shown if other sources also covered it. |

---

## 3. Review Dashboard (Web)

A lightweight web app for reviewing candidates and browsing the archive.

### Review Page (`/review`)

- Shows all `pending_review` candidate items for today
- Items grouped by AI-assigned dynamic categories
- Each item displays:
  - Title (linked to primary source if `has_external_source: true`, or to the post/tweet itself if `false`)
  - 2-3 sentence summary + "why it matters"
  - If `has_external_source: true`: "Discussed on:" links with engagement signals (e.g., [HN (320pts)] | [r/MachineLearning (1.2k)] | [@karpathy])
  - If `has_external_source: false`: "Source:" link to the post/tweet, plus "Discussed on:" only if other sources also covered it
  - Composite score
  - **Approve / Reject toggle** per item
- **"Save" button** at the bottom — locks in decisions, triggers digest assembly and email delivery
- Notification (email) sent when candidates are ready for review

### Archive Page (`/archive`)

- List of past digests ordered by date (e.g., "March 31, 2026 — 12 items")
- Click a date to view that day's published digest
- **Search bar** — full-text search across all items (title, summary, sources) with date filtering
- Search results show matching items across all past digests — each result shows title, summary snippet, date, source links
- Clicking a title in search results goes directly to the original source
- Clicking a date goes to that day's full digest

### Digest View (`/digest/:date`)

- Same content as the email — items grouped by dynamic categories, ordered by rank within each category
- Each item: title (links to primary/original source), 2-3 sentence summary, "why it matters", "Discussed on:" links with engagement signals
- The web version adds the ability to browse and scroll through the full digest in context

---

## 4. Email Delivery

After the admin clicks "Save" on the review dashboard, the digest is queued and sent at the email send time configured in admin settings.

### Email Structure

- **Subject:** "AI Digest — [Date]"
- **Body:**
  - Items grouped by dynamic categories
  - Each item formatted based on source type:

**When item has an external source (`has_external_source: true`):**
> **Anthropic releases Claude 4** ← links to anthropic.com/blog/claude-4
> Anthropic released Claude 4 with major improvements in reasoning and code generation...
> *Why it matters:* First major Claude release in 8 months.
> Discussed on: [HN (450pts)] | [r/MachineLearning (2.1k)] | [@karpathy]

**When item IS the source (`has_external_source: false`):**
> **Karpathy benchmarks Claude 4 against GPT-5** ← links to the tweet
> Andrej Karpathy ran a series of coding benchmarks comparing Claude 4 and GPT-5. Claude 4 outperformed on refactoring tasks while GPT-5 was stronger on greenfield code generation.
> *Why it matters:* First independent head-to-head comparison from a trusted source.
> Source: [@karpathy]

  - Footer with link to web archive version

### Recipients

Hardcoded list (Ritesh, Aman) — no subscription management for MVP.

---

## 5. End-to-End User Story

### Daily Flow

1. **Pipeline runs** (scheduled, configurable time)
   - All 34+ collectors fetch from their sources
   - Processing layer deduplicates, filters, ranks, summarizes
   - Candidate items land in the database with `pending_review` status
   - User gets an email notification that today's candidates are ready for review

2. **User opens review dashboard** (`/review`)
   - Sees candidates grouped by dynamic categories
   - Each item has summary, "why it matters", source links, score
   - Approves or rejects each item individually
   - Clicks **"Save"**

3. **System assembles the digest**
   - Only approved items are included
   - Grouped by categories, ordered by rank

4. **Digest is delivered**
   - Email sent to configured recipients
   - Same digest published to the web archive

5. **Later (anytime)**
   - User searches the archive for a topic they remember
   - Full-text search across all past items

### Edge Cases

- If the user doesn't review by end of day, nothing gets sent — no stale digests go out
- If a collector fails, the pipeline still runs with available sources and logs the failure
- If it's a slow news day and only a few items pass the quality bar, that's fine — no padding with filler
- If no items are approved, no digest is sent

---

## 6. Admin Settings Page (`/admin`)

Password-protected (same password as `/review`).

### Sections

**Pipeline Schedule**
- Configure when the daily collection + processing runs
- Simple time picker

**Sources (grouped by type)**
- **Hacker News** — keyword filters, minimum points
- **Reddit** — list of subreddits, add/remove
- **Twitter/X** — list of accounts, add/remove
- **RSS / Websites** — list of feed URLs, add/remove
- **Company Blogs** — list of blog feed URLs, add/remove
- **GitHub** — trending language, specific repo release feeds, add/remove
- **Product Hunt / Other** — feed URLs, add/remove

Each source shows its current status (active/failing) so you know if something broke.

**Item Age Cutoff**
- Input for max age in hours (default: 24-36h)

**Email Settings**
- Recipients list — add/remove email addresses
- Email send time — when the approved digest gets sent (e.g., 8:00 AM IST)
- Subject line hardcoded to "AI Digest — [Date]"

### Access Control

| Page | Auth required? |
|---|---|
| `/admin` | Yes (password) |
| `/review` | Yes (password) |
| `/archive` | No — open |
| `/digest/:date` | No — open |

---

## 7. Feedback Loop & Analytics

Measures content quality over time. No complex dashboards for MVP — just log the data for later analysis.

### Per-Item Signals (collected during review)
- **Approve/reject ratio** — if rejecting 80% of candidates daily, filtering/ranking needs tuning
- **Click-throughs** — which items the user actually clicks to read the full article
- **Category patterns** — which dynamic categories consistently get approved vs rejected

### Per-Digest Signals
- **Time to review** — duration between "candidates ready" notification and "Save" click
- **Items approved per digest** — trending down may mean source quality is degrading
- **Days skipped** — if the user stops reviewing, the digest isn't valuable enough

### Over Time
- **Source quality tracking** — which sources consistently produce approved vs rejected items, helps add/remove sources
- **Ranking accuracy** — are high-scored items getting approved more than low-scored ones? If not, ranking needs tuning

### Key Insight
The approve/reject decisions on the review dashboard ARE the feedback loop. Every day the user is telling the system what's good and what's not. This data can be used over time to improve filtering and ranking.

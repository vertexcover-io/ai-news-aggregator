# User Story — AI Newsletter Aggregator

## As a user, I want a daily AI news digest so I don't have to manually browse multiple sources.

---

## MVP User Story

### Setup (one-time)
- I edit a config file to set: pipeline schedule, email send time, email recipients
- Sources are pre-configured: HN, r/MachineLearning, r/LocalLLaMA, @_akhaliq, @karpathy, @simonw, OpenAI Blog

### Daily Flow

1. **Pipeline runs** (scheduled) — collects news from 7 sources across HN, Reddit, Twitter, and OpenAI Blog
2. **Processing:** System deduplicates, filters noise, ranks by quality, and generates summaries with "why it matters" for each item
3. **Notification:** I receive an email saying "Today's candidates are ready for review"
4. **Review:** I open the web dashboard (`/review`, password-protected), see candidates grouped by dynamic categories
5. **Curate:** I approve or reject each item individually
6. **Publish:** I click "Save" — system assembles the digest from approved items, schedules the email for the configured send time
7. **Read:** I click a title in the email — it takes me directly to the original source article

### What I see per item (review page & email)

- Title (links to the primary/original source — e.g., the blog post or paper)
- 2-3 sentence summary
- "Why it matters" one-liner
- "Discussed on:" links with engagement signals (e.g., [HN (320pts)] | [r/MachineLearning (1.2k)] | [@karpathy])

### What I don't have to do

- Browse HN, Twitter, Reddit separately
- Read duplicate stories across sources
- Sift through noise, memes, low-effort posts
- Worry about missing something important — cross-source signal catches it

### Edge cases

- No review by end of day = no digest sent
- Slow news day = fewer items, no filler
- A source goes down = others still run, failure logged
- No items approved = no digest sent

---

## Post-MVP (Full Vision)

### Admin setup (web UI)
- Admin settings page (`/admin`, password-protected)
- Configure sources grouped by type — add/remove subreddits, Twitter accounts, RSS feeds, etc.
- Set pipeline schedule, item age cutoff, email recipients, email send time
- Each source shows its status (active/failing)

### Expanded sources
- Scale from 7 to 34+ sources (full list in mvp-sources.md)
- Add GitHub trending, Product Hunt, Future Tools, company blogs, more subreddits, more Twitter accounts

### Web archive
- `/archive` — browse past digests by date
- `/digest/:date` — view a specific day's digest
- Full-text search across all past items by keyword and date

### Feedback loop
- Approve/reject ratio tracking
- Click-through tracking
- Source quality tracking — which sources produce items I approve vs reject
- Days skipped tracking

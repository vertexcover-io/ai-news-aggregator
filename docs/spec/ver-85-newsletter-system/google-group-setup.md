# Google Group setup for newsletter feedback

The newsletter sets `Reply-To: newsletter-feedback@vertexcover.io` on every send.
When subscribers hit Reply in their mail client, the message lands in this group,
which fans out to all team members. This is a one-time Google Workspace setup
that requires a workspace admin — it is not a code change.

## Why a group, not a personal address

- Replies reach both Aman and Ritesh without one of us having to forward manually.
- New team members can be added to the group later without changing any code or
  redeploying the API.
- We don't burn a personal inbox with subscriber feedback noise.
- The group serves as a searchable archive of all feedback ever sent.

## Steps (Workspace admin only)

### 1. Create the group

1. Go to <https://groups.google.com/> signed in as a Workspace admin.
2. Click **Create group**.
3. Group fields:
   - **Group name:** `Newsletter Feedback`
   - **Group email:** `newsletter-feedback` (the `@vertexcover.io` is appended)
   - **Description:** "Reply-to for AI Newsletter feedback. Subscribers reply
     to digest emails and the message lands here for the team."
4. Set **Group type:** Email list (or "Collaborative inbox" if you want
   assignable threads).

### 2. Configure access settings

In the group's settings (left sidebar in groups.google.com → the group → Group settings):

| Setting | Value | Why |
|---|---|---|
| Who can join the group | Invited only | We pick members manually |
| Who can view conversations | Group members | Privacy |
| Who can post | **Anyone on the web** | **Critical** — without this, every external subscriber's reply bounces with "you are not allowed to post." |
| Who can view members | Group members | |
| Allow email posting | On | Replies arrive via email, not the web UI |
| Conversation history | On | Searchable archive |
| Message moderation | No moderation | Replies should reach the team instantly |
| Spam message handling | Moderate spam | Otherwise spam pollutes the inbox |

### 3. Allow external senders (most common gotcha)

By default, Workspace blocks groups from receiving mail from outside
`vertexcover.io`. You must explicitly allow it.

In **Workspace Admin Console** (admin.google.com) — not just groups.google.com:

1. **Apps → Google Workspace → Groups for Business → Sharing settings**
   - Set **"Group access type"** to "Public" or "Anyone on the internet" so
     non-org senders can post.
2. **Apps → Google Workspace → Gmail → Spam, phishing, malware**
   - Make sure the group address is not on a blocked-senders list.
3. **The group's own settings** also have a per-group toggle for "external
   posters" — make sure it's enabled.

If a subscriber replies and gets back a `delivery failed: you do not have
permission to post` bounce, one of these three is wrong.

### 4. Add members

In the group settings → Members → **Add members**:

- `aman@vertexcover.io`
- `ritesh@vertexcover.io` (or whatever Ritesh's address is)

For each member, set:
- **Subscription:** "Each email" (every reply triggers a notification — do NOT
  set to "Daily digest", you want feedback to land in real time)
- **Role:** Member (Owner only for the workspace admin who created it)

Add new team members the same way as the team grows.

### 5. Verify the setup

From a personal email account that is **not** on `@vertexcover.io`:

1. Send a test email to `newsletter-feedback@vertexcover.io`.
2. Confirm both Aman and Ritesh receive it within a few seconds.
3. Reply from one of the receiving inboxes — confirm the original sender gets
   the response.

If steps 1-2 fail with a bounce, revisit Step 3 (external senders allowed).
If steps 1-2 succeed but only one of you receives the message, revisit Step 4
(member subscription set to "Each email").

## Code wiring

Already done. The pipeline worker reads `NEWSLETTER_REPLY_TO_EMAIL` from `.env`
and sets it as the `Reply-To` header on every digest. The default value in
`.env.example` is `newsletter-feedback@vertexcover.io`. Once the group exists,
no code change is needed — just make sure the value in production `.env`
matches the group address.

## Troubleshooting

**Replies bounce with "550 5.7.0 Suspicious mail":** Workspace's spam filter is
flagging external posters. Check Admin Console → Gmail → Quarantine.

**Only Aman gets replies, not Ritesh:** Ritesh's group subscription is set to
"No email" or "Daily digest". Change to "Each email".

**Replies arrive but the reply-thread breaks (subscriber doesn't see your
response):** Make sure the team replies *from their personal address*, not from
the group. Replying as the group masks the responder and confuses the thread.

**Group address itself starts getting marked as spam by external recipients:**
That's a deliverability issue separate from this setup. Check that the
`vertexcover.io` SPF record allows Google Workspace's mail servers
(`include:_spf.google.com`).

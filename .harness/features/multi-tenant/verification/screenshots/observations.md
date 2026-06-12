# UI Verification Observations — multi-tenant

Session: 2026-06-12, live stack (API :3000, Vite :5173, Postgres :5434/newsletter_mt reset+migrated fresh, Redis :6379 cleared).
Tenant-host resolution driven via `x-tenant-slug` extra headers (the project's supported dev/e2e mechanism; production Host resolution exercised by the same `resolveTenant` middleware).
External safety: SLACK_WEBHOOK_URL force-blanked (API logged `slack.notify.disabled`), ANTHROPIC/TAVILY keys blanked + browser-layer route stubs, Resend pointed at a local fake (`RESEND_BASE_URL=http://127.0.0.1:4571`).

**Expected page-level ordering (layout contract, public homepage):** masthead/nav → hero (headline, topic strip, subtagline) → today's issue → [from-the-canon when flagged] → inline subscribe → recent/elsewhere strip → footer (nav + colophon for tenant 0).

---

## PHASE3-C2-C3-signup-errors.png
- **PHASE3-C2 (mismatch)** — MET. Submitted name/email/password with mismatched confirm: alert "Passwords do not match" rendered (a11y `alert` role), URL stayed `/signup`. DB: `select count(*) from users where email='mismatch-tester@example.com'` → 0.
- **PHASE3-C3 (dup email)** — MET. Re-submitted with `admin@agentloop.dev`: alert "That email is already in use. Try signing in instead." (server 409 in console log), no second account (users count for that email stayed 1, tenants count unchanged at 2).
- Open review: card centered at 1280x900, labels above inputs, error text red and adjacent to the submit button; no clipping/overlap. Nothing wrong observed.

## PHASE3-C1-PHASE11-C3-wizard-step1-live-preview.png
- **PHASE3-C1** — MET. Fresh signup (`mira@mlopsweekly.dev`) → 201, session cookie, landed on `/admin/onboarding` "Setup · step 1 of 8".
- **PHASE11-C3 (live preview)** — MET. Preview pane is the real Hero composition: typing "MLOps Weekly" updated the preview masthead img alt + wordmark immediately; headline slot showed "Your headline goes here", topic strip "Topic one · Topic two · Topic three", today's-issue placeholder list with lorem entries (JUN 09/08/07). Later steps confirmed headline/strip/subtagline reflected live (innerText: "Ship models, not slide decks." / "PIPELINES · GPUS · OBSERVABILITY · COST" / uppercase subtagline).
- Open review: 8-step rail with Required/Optional markers, step 1 highlighted; preview framed in a browser chrome mock with `yourslug.ourdomain.com`. Nothing wrong observed.

## PHASE11-C2-wizard-slug-states.png
- **PHASE11-C2** — MET. Three live states from the status region (`role=status`):
  - `app` → "That word is reserved and can't be used"
  - `inference` (held by seeded tenant) → "inference.ourdomain.com is taken — pick another"
  - `mlops-weekly` → "mlops-weekly.ourdomain.com is available" (shown in PNG, green)
- Open review: helper copy lists reserved words app/admin/api; suffix `.ourdomain.com` rendered as a fixed addon. Nothing wrong observed.

## PHASE11-C4-wizard-prompts-stubbed.png
- **PHASE11-C4** — MET. Blurb submitted → `✦ Generate prompts` (button disabled until blurb non-empty) → two EDITABLE textareas labeled "RANKING PROMPT (EDITABLE)" / "SHORTLIST PROMPT (EDITABLE)" filled with the browser-layer stub values; ranking prompt edited to append "EDITED-BY-VERIFIER." and the edit persisted into `user_settings.ranking_prompt` at activation (DB check below). Anthropic never hit (key blanked + route stub).
- Open review: textarea borders highlight the edited field; preview pane unchanged. Nothing wrong observed.

## PHASE11-C5-wizard-sources-discovery.png
- **PHASE11-C5** — MET. `✦ Discover sources` (stubbed) rendered grouped click-to-add pills — REDDIT: `+ r/mlops`; RSS / BLOGS: `+ vLLM blog`. PNG shows "SELECTED · 0 SOURCES" + "Nothing selected yet" while pills are visible (nothing auto-added). Clicking `r/mlops` then manually adding `https://mlops.substack.com/feed` → "SELECTED · 2 SOURCES" (innerText). Manual add path = P8 per-source rows (2 rows in `sources` at activation).
- Open review: pills have + affordance, groups labeled, manual-add hint lists accepted formats. Nothing wrong observed.

## PHASE11-C6-activate-blocked-incomplete.png
- **PHASE11-C6** — MET. Fresh pending_setup signup (`blocked@incomplete.dev`) jumped to step 8: Activate button DISABLED (PNG shows washed-out button) under the callout "Finish these steps before activating:" listing Newsletter name, Subdomain, Homepage text, Prompts, Sources (add at least one). Server independently blocks: `POST /api/onboarding/activate` → **409** `{"error":"incomplete","missing":["name","slug","headline","prompts","sources"]}`.
- Open review: missing-steps callout uses warning tint; schedule defaults shown. Nothing wrong observed.

## PHASE11-C7-activated-public-site.png
- **PHASE11-C7** — MET. With all required steps complete, Activate flipped the tenant: redirected to `/admin` dashboard ("Scheduled to run daily at 06:00 Asia/Calcutta"); DB: tenant `mlops-weekly` status=active with name/headline applied; `user_settings` row created with the EDITED wizard prompts (`ranking_prompt` = "STUB: … EDITED-BY-VERIFIER.") and schedule; 2 `sources` rows; per-tenant scheduler reconciled — Redis repeat key `bull:processing:repeat:pipeline-run:34c6487a-163e-4943-ba3f-c54960f044e7` matches `tenants.id` for mlops-weekly. PNG: public site LIVE on the slug host with wizard branding (title "MLOps Weekly — Ship models, not slide decks.").
- **PHASE11-C1 (resume + fresh-login funnel)** — MET (evidence logged, same wizard surface as this PNG + step-1 PNG): mid-wizard reload restored step 5 ("Tune what gets picked") and step-4 field values ("Ship models, not slide decks." etc.); navigating to `/admin` mid-setup bounced back to `/admin/onboarding` (RequireOnboarding); after logout, a FRESH login landed directly at `/admin/onboarding` step 8 of 8 with everything intact.
- Open review: hero typography matches the AGENTLOOP layout template with tenant copy; nav has Sources + Admin + Subscribe only (no Must Read — canon off; no How it's built — not tenant 0). Nothing wrong observed.

## PHASE3-C4-C5-login-error-unauth-redirect.png
- **PHASE3-C5 (unauth redirect)** — MET. Logged-out navigation to `/admin/settings` → `/admin/login?next=%2Fadmin%2Fsettings` (URL in evidence log; PNG shows the login card).
- **PHASE3-C4 (login + wrong password)** — MET. Wrong password → red "Incorrect email or password." and stays on login (PNG). Correct password (`admin@agentloop.dev`) → landed on `/admin/settings` (honoring `?next=`). Earlier the same login path reached `/admin` from a plain `/admin/login`.
- Open review: Forgot password? / Create account links present. Nothing wrong observed.

## PHASE5-C8-PHASE7-C1-agentloop-homepage.png  (full page)
- **PHASE5-C8** — MET. Homepage served end-to-end through the real API for the known slug (`x-tenant-slug: agentloop` → 200 with AGENTLOOP payload); unknown slug → `/api/home` 404 (curl `x-tenant-slug: no-such-tenant` → 404).
- **PHASE7-C1** — MET. Section order in rendered text indexes: hero (102) → today's issue "Agents are eating the toolchain" (313) → inline subscribe "WHAT WE READ SO YOU DON'T HAVE TO" (524) → recent/elsewhere "ELSEWHERE" (588). Exact legacy hero copy "The daily read for people who ship with agents." + topic strip + "NO MODEL RELEASES…JUST THE CRAFT."; full nav MUST READ · SOURCES · HOW IT'S BUILT; footer colophon "AgentLoop is built by agents…" + "A VERTEXCOVER LABS PUBLICATION".
- **PHASE7-C3 (tenant-0 side)** — MET. Must Read + How it's built present in masthead, Elsewhere strip (3 columns) and footer for tenant 0 with Canon on.
- Open review: full-page capture; FROM THE CANON block present between today's issue and subscribe (canon on); no layout breaks, no orphaned sections. Nothing wrong observed.

## PHASE7-C2-C3-inference-homepage.png  (full page)
- **PHASE7-C2** — MET. Same layout, own branding: title "The Inference — The daily read for people building with inference.", headline/strip/subtagline rendered, per-tenant logo `<img src="/api/branding/logo?v=4a5eb7171b58e08a">` (green 1x1 PNG visible as the brand square), today's issue "Quantization without tears". Page text contains NO "AGENTLOOP" and NO "VERTEXCOVER" string (regex over full innerText).
- **PHASE7-C3** — MET. Canon off → no MUST READ anywhere (masthead, Elsewhere strip shows ONLY the Sources column, footer has Sources only); non-tenant-0 → no HOW IT'S BUILT and no colophon; SOURCES always present.
- Open review: Elsewhere strip with a single column looks intentional (no empty grid cells); footer "© 2026 THE INFERENCE". Nothing wrong observed.

## PHASE8-C1-C2-C3-settings-sources-panel.png
- **PHASE8-C1** — MET. Source management renders as a "Sources" card INSIDE `/admin/settings` ("Where your pipeline collects from…", 0 active badge, Add manually row, "Your sources" list with the r/LocalLLaMA row + health badge "Unchecked" + enable switch + trash). No standalone management route: `/admin/sources` renders the public 404 page ("404 · NOT FOUND / Off the loop.").
- **PHASE8-C2** — MET. Manual add (type select Reddit + `r/LocalLLaMA`) created the row (DB: `sources` row `type=reddit, config{subreddit: LocalLLaMA}`); row-scoped enable switch true→false PATCH persisted across reload (UI aria-checked=false after reload; DB enabled=false); remove deleted the row and after reload "No sources yet — add one above." (DB count 0).
- **PHASE8-C3** — MET. Invalid manual add (`not-a-url-at-all` as RSS/Blog) surfaced the API 400 as toast "invalid listing URL: not-a-url-at-all"; no row created (DB still only the reddit row at that point).
- Open review: framing includes the prompt textarea above and the sticky Run now/Save changes bar below (neighbour rule). Sticky bar sits at viewport bottom, not mid-page. Nothing wrong observed.

## PHASE12-C7-social-credentials-panel.png
- **PHASE12-C7** — MET. Panel renders LinkedIn as connect/disconnect-only: "OAuth Connection / Not connected / [Connect LinkedIn (disabled)]" + super-admin hint "The shared LinkedIn app is not configured yet — ask a platform super admin to set it up"; NO client id/secret inputs anywhere (regex over panel text); NO Twitter collector cookie card (no cookie/rettiwt text); tenant Twitter posting keys: 4 fields (API Key/Secret, Access Token/Secret) → Save Twitter → badge "Configured (updated 6/12/2026, 12:48:05 PM)" (visible in PNG); Clear Credentials → inline confirm "Are you sure? / Yes, clear" → DB `social_credentials` row deleted (count 0).
- Open review: Save and Clear buttons adjacent; statuses as badges. Nothing wrong observed.

## PHASE14-C1-sending-domain-pending.png
- **PHASE14-C1** — MET. Added `news.mlops-verify.dev` → Resend (fake) registered, panel shows **Pending** badge, paused-broadcast copy ("Until then the broadcast is paused; confirmations & resets still send from our shared address."), DNS records TABLE (TXT resend._domainkey p=MIGfMA0GCSqE2E **Waiting**; MX send feedback-smtp.resend.com **Waiting**) — all in PNG. Verify → badge flipped **Pending → Verified**, record statuses Waiting → Found (innerText evidence; Verified state also visible in the PHASE12-C7 PNG bottom edge). All Resend calls hit the local fake (S-web-04).
- Open review: table columns aligned; "DNS can take up to 48h" hint left of Verify. Nothing wrong observed.

## PHASE15-C1-C2-C4-super-admin-console.png
- **PHASE15-C1** — MET. Super admin (seeded via reset-link onboarding, password set on `/reset-password`) login LANDED on `/admin/tenants`: rows show name, owner email, slug, status badge (ACTIVE/IN SETUP), subscribers (—), relative last run ("about 1 hour ago"). PNG shows all four tenants.
- **PHASE15-C4** — MET. Search "inference" narrowed to The Inference only (AGENTLOOP/MLOps rows gone); status select "In setup" → only Blocked Tester; stats strip 4 TOTAL / 3 ACTIVE / 1 IN SETUP / 0 SUBSCRIBERS (PNG).
- **PHASE15-C2** — MET. tenant_admin (`admin@inference.dev`): `/admin/tenants` bounced to `/admin` (own dashboard, "Curate today's digest" visible, no PLATFORM OVERVIEW); API `/api/super/tenants` → 403.
- Open review: SUPER ADMIN chip next to wordmark; impersonation explainer under the table. Nothing wrong observed.

## PHASE6-C9-PHASE15-C3-impersonation-banner.png
- **PHASE15-C3** — MET. "Open →" on The Inference started an audited impersonation and routed into the tenant dashboard. `audit_log`: `impersonation_start` + `impersonation_stop` rows (actor = super admin user id, tenant_id = inference id).
- **PHASE6-C9** — MET. Persistent banner across the admin shell: "YOU'RE VIEWING **THE INFERENCE** AS SUPER ADMIN · CHANGES ARE AUDITED" + "EXIT IMPERSONATION ✕" (PNG, top bar). Banner survives reload and appears on `/admin/settings` too. Exit → back on `/admin/tenants` console; after reload impersonation stays cleared (server-side cookie delete).
- Open review: banner is the topmost element, dark tint, doesn't overlap nav. Nothing wrong observed.

## PHASE16-C1-C2-C3-notifications-features.png
- **PHASE16-C1** — MET. Notification email `alerts@agentloop.dev` + Slack webhook saved. DB: `tenants.notify_email` plaintext; `tenants.slack_webhook` = D-012 ciphertext JSON `{"ct":"…","iv":"…","tag":"…"}` with NO plaintext URL. API `GET /api/settings/notifications` → `{"notifyEmail":"alerts@agentloop.dev","slackWebhookSet":true,…}` — never the raw URL; the webhook input re-renders as `•••••••• (configured — paste a new URL to replace)` (PNG).
- **PHASE16-C2** — MET (claim wording). New-tenant defaults OFF: `inference`, `mlops-weekly` (created through the real wizard), and the pending tenant all have `feature_canon/deliverability/eval = f` in DB; tenant 0 grandfathered on. Toggles independent: flipping Eval changed only `feature_eval` (t→f→t observed in DB), Canon only `feature_canon`. Canon OFF hid the public MUST READ masthead nav link while `must_read_entries` row survived (count still 1 mid-toggle); Canon ON restored the nav. **But see DEFECT ADV-2 in adversarial-findings.md: the homepage "FROM THE CANON" block and the /must-read page itself stay visible with the flag off — EDGE-014's "Page hidden" is only implemented for the nav.**
- **PHASE16-C3** — MET. No shortlist-size control anywhere on settings (0 `input[type=number]`, no matching label text); after Save changes, `user_settings.shortlist_size` = 30 (internal default) for both agentloop (created by this save) and mlops-weekly (created by activation) — submitted unchanged.
- Open review: framing includes Sending domain card bottom (above) and Features card top (below) + sticky save bar. Nothing wrong observed.

---

## Console/network
Console log for the whole session: `verification/traces/console-ui-session.log`. The only errors are expected fetch failures for negative tests (401 on unauth `/api/auth/me`, 409 signup duplicate/activate-incomplete, 400 invalid source add, 403 super guard). No unexpected JS errors on any primary flow.

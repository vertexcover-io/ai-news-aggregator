# UI Observations — VER-85

## 01-home-1280.png — `/` @ 1280×720
- **REQ-001 (subscribe widget on /)**: MET. "NEWSLETTER" eyebrow + "Get the daily AI digest in your inbox" heading + email input + consent checkbox + Subscribe button visible at bottom of page.
- **REQ-027 (links to /privacy and /terms)**: MET. DOM probe found `<a href="/privacy">Privacy Policy</a>` and `<a href="/terms">Terms of Service</a>` inline in the consent label.
- **Open visual review**: The Ledger layout renders correctly: serif "The Archive" headline, mono eyebrow, "All / May" filter chips, hairline-divided rows with date block + "No stories" body + "0 stories" right meta. Most rows show "No stories" because most archives have 0 stories — this is data state, not a UI defect.
- Console errors: 0.

## 02-privacy-1280.png — `/privacy` @ 1280×720
- **REQ-025**: MET. Renders "Privacy Policy" with sections: What data we collect, How we use it, How to unsubscribe, Contact.
- **Open visual review**: clean, on-brand, no anomalies.
- Console errors: 0.

## 03-terms-1280.png — `/terms` @ 1280×720
- **REQ-026**: MET. Renders "Terms of Service" with Subscription terms, Newsletter content, Unsubscribe, No warranties.
- **Open visual review**: matches privacy page styling. Clean.
- Console errors: 0.

## 04-confirm-success-1280.png — `/confirm?status=success`
- **REQ-005**: MET. "CONFIRMED" eyebrow + "You're subscribed!" headline + "You'll receive the AI Newsletter in your inbox." body.
- **Open visual review**: Emoji "🎉" sits inline in the H1 — acceptable, on-brand for a success page.
- Console errors: 0.

## 05-confirm-expired-1280.png — `/confirm?status=expired`
- **REQ-007**: MET. "LINK EXPIRED" eyebrow + "This confirmation link has expired." headline + remediation copy.
- Console errors: 0.

## 06-confirm-invalid-1280.png — `/confirm?status=invalid`
- **REQ-008**: MET. "INVALID LINK" eyebrow + "This link is invalid." headline.
- **Open visual review**: No remediation/CTA copy under the headline (compare /confirm?status=expired which says "Please subscribe again..."). Minor UX: a user landing here has no next step. Not a blocking spec defect.
- Console errors: 0.

## 07-unsubscribe-success-1280.png — `/unsubscribe?status=success`
- **REQ-015**: MET. "UNSUBSCRIBED" eyebrow + "You've been unsubscribed." headline + body.
- Console errors: 0.

## 08-admin-login-1280.png — `/admin/login`
- Renders an "Admin" card with Password input + Sign in button + Back-to-archive link.
- Console error: `[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ /api/admin/me`. This is the auth-status probe firing on a not-logged-in visitor — expected behaviour, not a defect, though the noisy 401 in DevTools could be hidden by reading the response and treating 401 as the "logged-out" branch silently.

## 09-admin-analytics-1280.png — `/admin/analytics` (logged in)
- **REQ-029**: MET. All seven metric cards render: SUBSCRIPTIONS, UNSUBSCRIPTIONS, EMAILS SENT, BOUNCES, SPAM COMPLAINTS, OPENS, CLICKS. From/To date inputs + Granularity selector visible.
- Defaults: From 05/04/2026, To 05/05/2026 — a 1-day window, so all counts are 0. That's data-state, not a UI defect.
- Console errors: 0.

## 10-home-mobile-375.png — `/` @ 375×812
- Layout reflows cleanly. Subscribe widget retains email input, consent checkbox, Subscribe button. No horizontal overflow.
- Console errors: 0.

## Adversarial second-pass notes
- /confirm?status=invalid lacks a "subscribe again" CTA (minor copy gap, see above).
- /admin/login emits a noisy 401 in console on every fresh load; consider gating the `/api/admin/me` probe behind a query-param so the dev console stays clean.
- Otherwise: second pass clean across 10 screenshots.

## Re-verification 2026-05-05 (post-nav-link)

UI changed since the original verification (commit 03fdcfd):
1. `SubscribeWidget` on `/` now centered with `mx-auto max-w-[480px]` (previously left-aligned at `max-w-[480px]`).
2. New "Subscribe" link added to `PublicLayout` nav, sitting next to "About". On `/` it `preventDefault`s and smooth-scrolls to `#subscribe`; on any other route it navigates to `/#subscribe` and scrolls.
3. The widget container now has `id="subscribe"` and `scroll-mt-24`.

### homepage-1280-v2.png — `/` @ 1280×720
- **REQ-001 (subscribe widget on /)**: MET (still). Widget present at the bottom of the page.
- **New: nav Subscribe link visible**: MET. Two anchors in nav — `Subscribe` at rect `{x:886.8, y:16, w:80.9, h:44}` href `/#subscribe`, `About` at rect `{x:975.7, y:16, w:54.8, h:44}` href `https://vertexcover.io`. Spacing 8px between (right of Subscribe = 967.7, left of About = 975.7). Aligned cleanly.
- **Open visual review**: nav looks balanced — brand "AI Newsletter" left, two action links right. No visible defects.
- Console errors: 0.

### homepage-1280-subscribe-section-v2.png — `/` @ 1280×720, scrolled to `#subscribe`
- **REQ-001 (subscribe widget on /)**: MET. The `mx-auto max-w-[480px]` container measures `{x:392.5, y:1724, w:480, h:184}` inside main `{x:202.5, y:77, w:860}` — i.e. centered (left padding 190 ≈ right padding 166.5; minor asymmetry due to Tailwind's `px-6` on parent giving 24px both sides, then 480 + 332/2 each side). Confirmed centered.
- **REQ-027 (privacy/terms links)**: MET (still). Consent label contains both anchors.
- Open visual review: widget visually centered under the rest of the listing rows. Hairline divider above. Clean.
- Console errors: 0.

### homepage-1280-after-nav-click-v2.png — `/` @ 1280×720, after clicking Subscribe nav link from same page
- **New: smooth-scroll behavior**: MET. After click, `#subscribe` rect becomes `{top:359, bottom:576}` inside 720-tall viewport (well within view). `location.hash` is empty (handler called `preventDefault`), `scrollY=1332`. Spec-conformant: same-page click does smooth-scroll without polluting the URL hash.
- Console errors: 0.

### homepage-375-v2.png — `/` @ 375×667
- **Mobile reflow check**: MET. Both nav links fit on the same row. `Subscribe` at rect `{x:200.3, y:16, w:80.9, h:44}`, `About` at `{x:289.2, y:16, w:54.8, h:44}`. Right edge of About at x=344, viewport width 375 — comfortable margin.
- Open visual review: brand + two links fit; hero "The Archive" centered; chips and listing intact.
- Console errors: 0.

### homepage-375-subscribe-section-v2.png — `/` @ 375×667, scrolled to widget
- Widget reflows: full-width on narrow viewport (no max-width constraint visible since main column is < 480px). Form, consent label, Subscribe button all stack cleanly.
- Console errors: 0.

### privacy-1280-with-nav-v2.png — `/privacy` @ 1280×720
- **REQ-025**: MET (still).
- **New: nav Subscribe link present on non-home page**: MET. Same anchors as home: `Subscribe` href `/#subscribe`, `About` href `https://vertexcover.io`.
- Console errors: 0.

### privacy-to-subscribe-after-nav-v2.png — clicked Subscribe from `/privacy`
- **New: navigate-then-scroll behavior**: MET. After click, URL becomes `http://localhost:5173/#subscribe`, `location.pathname='/'`, `location.hash='#subscribe'`. Widget rect `{top:359, bottom:576}` — in viewport. Cross-route navigation + scroll works.
- Console errors: 0.

### confirm-invalid-1280-v2.png — `/confirm?status=invalid` @ 1280×720 (refresh)
- **REQ-008**: MET. "INVALID LINK" eyebrow + "This link is invalid." headline + remediation copy "Please subscribe again to receive a new confirmation email." now visible below the headline. The earlier observation noted a missing CTA — copy is now present (per commit 851cffa "missing CTA" fix). Still no clickable CTA button, just remediation text — matches the parallel `/confirm?status=expired` page styling.
- Console errors: 0.

### Summary
No new visual defects. The centering and nav link both render cleanly with the expected geometry (centered widget at x=392.5–872.5 of an 812-wide content column; nav link 8px gap from About). Smooth-scroll on `/` and navigate-then-scroll from other routes both verified end-to-end via DOM rect probes.

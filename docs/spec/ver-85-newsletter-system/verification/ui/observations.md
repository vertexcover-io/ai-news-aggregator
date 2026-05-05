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

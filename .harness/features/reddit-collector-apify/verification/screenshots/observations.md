# Screenshot Observations

## Infrastructure

API started on port 3000 (started fresh; not pre-existing).
Web started on port 5173 (started fresh; not pre-existing).
PostgreSQL on port 5434, database: newsletter.
Redis on port 6379 (was already running).

Expected layout ordering on /admin/settings (super admin impersonating):
Sources → Schedule → Analytics → Shortlist prompt → Ranking prompt → Site & sending → Branding → Social posting → Email sending → Sending domain → Notifications → Features → **Apify integration** → Run now/Save changes footer

---

## PHASE5-C1-settings-super-admin.png

**Claim IDs evidenced:** PHASE5-C1

**Screenshot:** verification/screenshots/PHASE5-C1-settings-super-admin.png (80 KB)
**Capture context:** Super-admin logged in (superadmin@test.com / role=super_admin), impersonating AgentLoop tenant, on /admin/settings.

### Spec-based check
- **REQ-019 (super-admin panel visible):** MET — The Apify integration section (heading "Apify integration", description "Platform-level Apify API token used by the Reddit collector…") is rendered in the page snapshot as `generic [ref=e307]`. The section shows status "Configured" with an updatedAt timestamp. The token value itself does not appear anywhere in the snapshot.
- **REQ-015 (token saves → configured status):** CANNOT_ASSESS at this screenshot — this is the pre-save screenshot showing "Configured" from the API step earlier.
- **REQ-024 (token never visible):** MET — no token string appears in the accessibility snapshot or page text.

### Open visual review
Settings page renders correctly with impersonation banner at top ("You're viewing AgentLoop (pipeline e2e) as super admin · changes are audited"). Apify section is positioned after "Features" and before the footer bar, consistent with expected layout. No alignment or contrast issues visible. All other sections (Sources, Schedule, Analytics, Branding, Social, Notifications, Features) render normally.

---

## PHASE5-C1-apify-configured-after-save.png

**Claim IDs evidenced:** PHASE5-C1

**Screenshot:** verification/screenshots/PHASE5-C1-apify-configured-after-save.png (73 KB)
**Capture context:** After clicking "Update token", filling in "apify_test_new_token_verify456", and clicking "Save". The panel re-rendered with updated timestamp.

### Spec-based check
- **REQ-019 (badge flips to Configured with updatedAt):** MET — After save, the panel shows "Configured" + "Updated 6/18/2026, 1:07:35 PM". The input form closed; "Update token" and "Clear" buttons reappear.
- **REQ-024 (token not echoed):** MET — The token value "apify_test_new_token_verify456" does not appear in the rendered panel; only the status badge and timestamp are shown.
- **REQ-015 (200 with configured:true + updatedAt):** MET (confirmed via API step; the web panel reflects the API response).

### Open visual review
The panel updated correctly. Status badge changed from the token-entry form back to "Configured" state with a fresh timestamp. No token value rendered anywhere on the page. Page layout unchanged; impersonation banner still at top.

---

## PHASE5-C2-tenant-admin-no-apify.png

**Claim IDs evidenced:** PHASE5-C2

**Screenshot:** verification/screenshots/PHASE5-C2-tenant-admin-no-apify.png (73 KB)
**Capture context:** Signed out of super-admin session; logged in as tenant_admin (admin@agentloop.dev / role=tenant_admin), on /admin/settings.

### Spec-based check
- **REQ-019 (Apify panel NOT visible to tenant_admin):** MET — Full accessibility snapshot of the main element shows sections: Settings heading → Sources → Schedule → Analytics → Shortlist/Ranking prompts → Site & sending → Branding → Social posting → Email sending → Sending domain → Notifications → Features → Run now/Save footer. No "Apify integration" section appears anywhere in the snapshot.
- **EDGE-011 (non-super-admin cannot access Apify route):** Confirmed via API test (403 returned); UI corroborates (panel not rendered).

### Open visual review
The settings page for tenant_admin renders all expected sections without the Apify integration section. The page ends cleanly at "Features" followed by the "Run now" + "Save changes" footer bar. No orphaned UI elements, no empty placeholder where Apify section should be. Layout and spacing look correct.

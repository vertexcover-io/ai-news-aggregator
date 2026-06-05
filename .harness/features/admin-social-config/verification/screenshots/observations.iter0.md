# Screenshot observations — admin-social-config

Each entry: spec-based check track + open visual review track. PNG file read via `Read` tool before grading.

---

## 01-panel-not-configured.png (initial render, no DB rows)

### Spec-based checks

| Requirement | Verdict | Evidence |
|---|---|---|
| REQ-010 — panel renders on `/admin/settings` | **MET** | Card with heading "Social posting credentials" visible at bottom of page. |
| REQ-010 — both platforms have their own form | **MET** | LinkedIn `h3` followed by Client ID / Client Secret / API version fields + Save LinkedIn button; Twitter `h3` followed by 4-field grid + Save Twitter button; horizontal divider between. |
| REQ-010 — "Not configured" status when no creds | **MET** | Both pills (right-aligned with each h3) read "Not configured" on grey background. |
| REQ-010 — write-only (no pre-populated secrets) | **MET** | Client ID / Client Secret placeholders read "Not stored locally — enter to update"; all 6 secret inputs empty. apiVersion correctly shows the default `202511` (non-secret). |
| Inputs use `type="password"` for the 6 secret fields | **MET** | Live DOM probe (browser_evaluate): clientId/clientSecret/apiKey/apiSecret/accessToken/accessTokenSecret all `type:"password"`. apiVersion is `type:"text"` (intentional — non-secret). |

### Open visual review

- The "Social posting credentials" card sits **below** the sticky "All changes saved / Run now / Save changes" action bar. The action bar visually belongs to the form *above* it (sources/schedule/analytics) but its position makes the social panel feel like a separate page section. Not a defect, but a minor UX cue gap — first-time users may wonder whether "Save changes" applies to the social panel too. (It doesn't; the social panel has its own per-platform Save buttons.)
- Placeholder copy "Not stored locally — enter to update" is clear about the write-only contract — explicitly tells the user why fields are empty.
- Twitter form uses a 2×2 grid (API Key / API Secret on top row, Access Token / Access Token Secret on bottom). Visually compact and readable.
- No alignment / contrast / clipping / overlap issues observed.

---

## 02-linkedin-saved.png (after PUT linkedin via UI)

### Spec-based checks

| Requirement | Verdict | Evidence |
|---|---|---|
| REQ-010 — status pill flips to "Configured" with apiVersion + updatedAt | **MET** | Pill reads "Configured (apiVersion 202511 · updated 19/05/2026, 17:05:51)" on green/teal background. |
| REQ-010 — fields cleared after successful save | **MET** | clientId + clientSecret values empty after save (live DOM probe). The form reset is what makes the write-only contract honest. |
| Design §4.5 — Clear button appears when configured | **MET** | "Clear Credentials" button now visible next to "Save LinkedIn". Absent on Twitter section (which is still Not configured). |
| Twitter unaffected | **MET** | Twitter pill still "Not configured" — saving LinkedIn did not cross-contaminate state. |

### Open visual review

- "Configured" pill uses a green/teal background distinct from grey "Not configured" — strong visual signal of state change.
- Pill text includes both apiVersion and human-formatted local timestamp (`19/05/2026, 17:05:51`). Useful operator context. UK date format suggests locale-aware formatting; might surprise US operators — minor.
- "Clear Credentials" button rendered as outline / ghost style, "Save LinkedIn" as primary (filled black) — correct visual hierarchy (destructive action de-emphasised).
- No flicker observed; status pill update is atomic.

---

## 03-reload-persists.png (after full page reload)

### Spec-based checks

| Requirement | Verdict | Evidence |
|---|---|---|
| REQ-010 — status persists across reload | **MET** | After `browser_navigate` reload, pill still reads "Configured (apiVersion 202511 · updated 19/05/2026, 17:05:51)" with identical timestamp (no double-save). |
| REQ-010 — form fields remain empty after reload | **MET** | clientId / clientSecret values empty (live DOM probe). Server's `GET /api/admin/social-credentials` returned only status, not secrets — confirmed by VS-7 API test. |
| apiVersion default re-renders | **MET** | apiVersion field shows `202511` (the persisted value). |
| Clear button still present | **MET** | Clear Credentials button rendered. |

### Open visual review

- Identical to screenshot 02 visually — exactly what we want from a reload: stable, idempotent presentation. No layout shift.

---

## 04-twitter-saved.png (after PUT twitter via UI)

### Spec-based checks

| Requirement | Verdict | Evidence |
|---|---|---|
| REQ-010 — Twitter status flips to Configured | **MET** | Twitter pill: "Configured (updated 19/05/2026, 17:07:03)". No apiVersion shown (correct — Twitter has none). |
| REQ-010 — all 4 Twitter secret fields cleared after save | **MET** | apiKey/apiSecret/accessToken/accessTokenSecret all empty (live DOM probe). |
| LinkedIn unaffected | **MET** | LinkedIn pill still "Configured (apiVersion 202511 · updated 19/05/2026, 17:05:51)" — independent per-platform forms. |
| Both forms now have Clear button | **MET** (assumed — screenshot framing emphasizes Twitter form; LinkedIn Clear was verified at screenshot 02) |

### Open visual review

- Twitter "Configured" pill format `Configured (updated <ts>)` is slightly inconsistent with LinkedIn's `Configured (apiVersion 202511 · updated <ts>)` — different shape, different bullet character. This is intentional given Twitter has no apiVersion, but a reader scanning both pills sees two slightly different structures. Acceptable.
- Twitter Save button now also has a Clear Credentials button next to it (visible in the full panel view; cropped in this viewport screenshot).
- No console errors during save.

---

## 05-linkedin-cleared.png (after Clear LinkedIn → confirm)

### Spec-based checks

| Requirement | Verdict | Evidence |
|---|---|---|
| Design §4.5 — Clear with confirm flow | **MET** | First "Clear Credentials" click reveals inline confirm ("Yes, clear" + Cancel — implemented via `confirming` state, not native `window.confirm()`). Second click on `[data-testid="linkedin-clear-confirm"]` triggers DELETE. |
| REQ-010 — pill flips back to "Not configured" | **MET** | LinkedIn pill now reads "Not configured" (grey background); Twitter pill still "Configured (updated 19/05/2026, 17:07:03)". |
| Clear is scoped per-platform | **MET** | Clearing LinkedIn did not affect Twitter row. |
| Clear button removed when not configured | (implicit MET) | Now that LinkedIn is back to Not configured, the Clear Credentials button is no longer shown for LinkedIn (only Save LinkedIn remains, mirroring screenshot 01). Twitter still has its Clear button. |

### Open visual review

- The inline confirm pattern (no modal dialog) keeps users in flow — good. Two-click destructive action is a fine pattern for "clear secrets."
- Discoverability of the second confirm step is good: "Yes, clear" sits in the same visual spot as "Clear Credentials" so the user's attention doesn't shift.
- No accidental "Twitter cleared" surprise — independence held.

---

## Cross-screenshot consistency

- No layout reflow between states; only the status pill, the conditional Clear button, and the form values change.
- All 5 screenshots within size cap (≤200 KB each; observed 64–76 KB).
- 0 console errors across the entire 5-screenshot run.
- Browser cookies: `admin_session` HttpOnly cookie carried across all 5 captures (logged in once at start).

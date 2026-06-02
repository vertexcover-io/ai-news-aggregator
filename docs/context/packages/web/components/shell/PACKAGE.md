---
governs: packages/web/src/components/shell/
last_verified_sha: 5a2ff20
key_files: [Masthead.tsx, Footer.tsx, BrandMark.tsx, InlineSubscribeCard.tsx]
flow_fns: [Masthead.tsx::Masthead, Footer.tsx::Footer]
decisions: []
status: active
---

# components/shell/ — public site chrome

## Purpose

Nav, footer, brand mark, and inline subscribe card — the chrome shared across all public pages via `PublicLayout`.

## Public surface

| Component | Effect |
|---|---|
| `Masthead()` | Brand mark + "AGENTLOOP" logo + nav links (Must Read, Sources, How it's built, Admin link when authenticated, Subscribe) with active-state underline |
| `Footer()` | Colophon (built-by-agents blurb) + subscribe form + bottom nav links + copyright |
| `BrandMark({ size, className })` | SVG brand mark (the ◇ lozenge icon) |
| `InlineSubscribeCard()` | Mid-page subscribe prompt: "AgentLoop · free · delivered every morning" + email input + subscribe button |

## Depends on / used by

- **Uses:** `hooks/useAdminSession` (Masthead shows Admin link when authenticated), `api/subscribe`, `lib/analytics`, `lib/subscriptionStorage`
- **Used by:** `layouts/PublicLayout.tsx`, `pages/ArchivePage.tsx`, `pages/HomePage.tsx`, `pages/SourcesPage.tsx`

## Data flows

```
Masthead:
  useLocation() → pathname → deriveActive: "must-read" | "sources" | "built" | null
  useAdminSession() → isAdmin
  Renders:
    ├─ BrandMark + "AGENTLOOP" → Link to /
    ├─ "A Vertexcover Labs publication" subtitle
    └─ Nav: Must Read · Sources · How it's built · [Admin → if authenticated] · Subscribe→ (hash link)

Footer:
  useLocation() → showColophon = pathname !== "/built"
  FooterSubscribeField:
    ├─ idle/loading: email input + "Subscribe →" button
    ├─ success: "Thanks — check your inbox."
    └─ error: re-shows input (error state, but silently)
  Bottom: BrandMark + nav links (Must Read · Sources · How it's built) + copyright
```

## Gotchas / landmines

- **Footer subscribe error is silent**: On error, `FooterSubscribeField` sets state to "error" but renders the same idle input form. The only visible change is the button is re-enabled. Considered acceptable — Resend's webhook handles the subscription async, and transient errors are common.
- **Masthead "Subscribe→" uses hash link**: `to={{ hash: "#subscribe" }}` triggers `PublicLayout`'s hash-scroll polling to find the footer subscribe element.

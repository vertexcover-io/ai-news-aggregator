---
governs: packages/api/src/lib/email/templates/
last_verified_sha: 5a2ff20
key_files: [index.ts, confirmation.tsx, newsletter.tsx, welcome.tsx]
flow_fns: []
decisions: []
status: active
---

# lib/email/templates/ — React Email JSX templates rendered to HTML strings

## Purpose

React Email templates for three transactional emails: subscription confirmation, the daily newsletter digest, and the welcome email. Rendered to HTML strings via `@react-email/components` `render()`. No DB access, no HTTP — pure JSX → HTML.

## Public surface

- `renderConfirmation({ confirmUrl, baseUrl }) → Promise<string>` — renders `ConfirmationEmail` JSX to HTML
- `renderNewsletter({ stories, issueDate, issueNumber, unsubscribeUrl, baseUrl }) → Promise<string>` — renders `NewsletterEmail` JSX to HTML (max 5 stories)
- `renderWelcome({ baseUrl, unsubscribeUrl }) → Promise<string>` — renders `WelcomeEmail` JSX to HTML
- Exported types: `NewsletterEmailProps`, `NewsletterStory`, `WelcomeEmailProps`

## Depends on / used by

**Uses:** `@react-email/components` (Html, Head, Body, Container, Section, Text, Link, Hr, Preview, Img), `react`
**Used by:** `index.ts` (confirm flow sends confirmation email), pipeline (newsletter send worker)

# SPEC — LinkedIn post: top-5 + fixed header + review preview

See `design.md` for context.

## Requirements (EARS)

- **REQ-1** When the pipeline composes a LinkedIn post, the system shall render the body as: header line, blank line, up to five `→ {summary}` bullets separated by blank lines, blank line, the constant footer `Full newsletter linked in the comments.`.
- **REQ-2** When `run_archives.hook` is `NULL` or empty after trim, the LinkedIn composer shall use the constant `DEFAULT_LINKEDIN_HOOK = "AgentLoop — Today in Agentic Engineering"` as the header.
- **REQ-3** When `run_archives.hook` is non-empty after trim, the LinkedIn composer shall use that value verbatim as the header.
- **REQ-4** The LinkedIn composer shall include at most `LINKEDIN_MAX_STORIES = 5` bullets, in ranked order, from stories whose summary is non-empty after trim.
- **REQ-5** When a ranked archive has fewer than 5 usable-summary stories, the LinkedIn composer shall emit only those bullets.
- **REQ-6** The rerank archive-write path in `workers/run-process.ts` shall persist `hook = NULL` regardless of what the LLM emits, so new runs default to the constant header at compose time.
- **REQ-7** The `DigestMetaPanel` regenerate handler shall ignore `meta.hook` returned from the API and preserve the current `values.hook` across regenerate.
- **REQ-8** The `DigestMetaPanel` component on the review page shall present the existing hook input labeled "LinkedIn Header" with `placeholder = DEFAULT_LINKEDIN_HOOK`.
- **REQ-9** The `DigestMetaPanel` component shall render a read-only "LinkedIn post" preview block whose contents exactly mirror what the pipeline composer would emit, given the current header field value and the current top-5 items prop.
- **REQ-10** The Twitter composer behavior shall remain unchanged.
- **REQ-11** The notifier guard that skips when no digest content is available shall still apply: `composePosts` returns `linkedinText: null` when no story has a non-empty summary.

## Constants (new in `@newsletter/shared/constants`)

- `DEFAULT_LINKEDIN_HOOK = "AgentLoop — Today in Agentic Engineering"`
- `LINKEDIN_MAX_STORIES = 5`
- `LINKEDIN_BULLET_PREFIX = "→ "`
- `LINKEDIN_FOOTER = "Full newsletter linked in the comments."`

## Verification scenarios

- **VS-1 (unit, compose.ts)** Given a `ComposeInput` with `hook=null` and 7 stories with non-empty summaries, `buildLinkedin` returns a string whose 7 lines (split on `\n\n`) are: `DEFAULT_LINKEDIN_HOOK`, 5 `→ <summary>` bullets, `Full newsletter linked in the comments.`.
- **VS-2 (unit, compose.ts)** Given `hook="Custom header"` and 3 stories, `buildLinkedin` returns `["Custom header", "→ s1", "→ s2", "→ s3", "Full newsletter linked in the comments."].join("\n\n")`.
- **VS-3 (unit, compose.ts)** Given 0 stories, `composePosts` returns `{ linkedinText: null, twitter: ... }`.
- **VS-4 (unit, compose.ts)** Stories whose `summary` is `""`/whitespace are filtered before slicing top-5.
- **VS-5 (unit, web)** `DigestMetaPanel` rendered with `hook=""` and 6 ranked items shows a preview block matching VS-1.
- **VS-6 (ui)** Loading `/admin/review/:runId` in a browser shows the LinkedIn header field with the constant placeholder and a LinkedIn preview block; editing the header re-renders the preview's first line.
- **VS-7 (unit, DigestMetaPanel)** When `regenerateDigestMeta` mock resolves with `{ headline:"H", summary:"S", hook:"LLM-HOOK", twitterSummary:"T" }` and panel was rendered with `values.hook = "existing"`, after regenerate the `onChange` payload carries `hook: "existing"` (LLM hook discarded).
- **VS-8 (typecheck/lint)** `pnpm typecheck` and `pnpm lint` pass.

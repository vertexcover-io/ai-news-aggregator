# Use .claude/rules/ directory instead of appending to CLAUDE.md

When adding persistent instructions or learnings that Claude should follow in every session, write them as files in `.claude/rules/` (or a subdirectory like `.claude/rules/learnings/`). Do not append references or content to CLAUDE.md. Files in `.claude/rules/` are auto-loaded recursively by Claude Code every session.

Why: Avoids CLAUDE.md bloat and manual maintenance — the rules directory handles discovery automatically.

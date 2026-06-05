# /learn Skill Design

**Date:** 2026-04-03
**Linear:** VER-38
**Status:** Draft

## Problem

Claude repeatedly makes the same code pattern mistakes (over-engineered repository patterns, unnecessary intermediate types, factory closures, etc.). The current `harness:learn` skill only runs inside the orchestrate DAG, captures orchestration friction (not code pattern mistakes), and misses corrections made after orchestration completes. There is no mechanism to turn user corrections into persistent rules that prevent the same mistake in future sessions.

## Solution

A standalone `/learn` skill that scans the current conversation, identifies user corrections about code patterns, deduplicates against existing rules, and writes concise rule files to `.claude/rules/learnings/`. These files are auto-loaded by Claude Code in every future session — no CLAUDE.md changes needed.

## Skill Definition

- **Invocation:** `/learn` — manual, callable at any point in a session
- **Arguments:** None — scans full conversation context automatically
- **Output:** One or more rule files written to `.claude/rules/learnings/<slug>.md`
- **Side effects:** None — no CLAUDE.md edits, no git commits, no hooks

## Session Scanning Logic

The skill scans the conversation for correction signals — moments where the user pushed back on Claude's approach.

### Correction signals (detect these)

- User explicitly says to change something: "don't do X", "use Y instead", "remove this", "why did you add X"
- User rejects a pattern: "this is over-engineered", "keep it simple", "we don't need this abstraction"
- User redirects approach: "no, just pass it directly", "that's not how we do it here"

### Not correction signals (ignore these)

- User adding new requirements: "also add LinkedIn URL"
- User clarifying scope: "only do this for pipeline"
- Claude self-correcting during its own reasoning
- User approving Claude's work: "looks good", "yes"
- Normal back-and-forth discussion without a direction change

### 4-Criteria Filter

Each detected correction must pass all 4 criteria to become a learning candidate:

1. **User-initiated** — the user told Claude to change, not Claude self-correcting
2. **About HOW code is written** — patterns, style, architecture, not WHAT to build (features, specific data)
3. **Generalizable** — applies beyond the specific file/function being discussed
4. **Likely to recur** — Claude would plausibly make the same mistake again in a future session without this rule. One-time configuration fixes (changing a test script, updating a hook, fixing a specific file) will NOT recur because the fix is already in the codebase. Only capture patterns where Claude's default behavior would lead it to repeat the mistake when writing NEW code.

Corrections that fail any criterion are silently discarded.

## Duplicate Detection

Before writing a learning, the skill checks for semantic overlap against all existing rules.

- Read all `.md` files in `.claude/rules/` and `.claude/rules/learnings/`
- For each candidate learning, compare its core instruction against existing rules
- Skip if an existing rule already covers the same guidance (even if worded differently)
- Exception: if an existing rule is vague but the learning is more specific and actionable, write the learning anyway

Example: if `code-quality.md` already says "no `any` types" and the candidate is "avoid using `any`, use `unknown` instead" — skip it.

## Learning File Format

Each learning is a concise, actionable rule file.

**Location:** `.claude/rules/learnings/<slug>.md`

**Filename:** Kebab-case slug describing the pattern (e.g. `no-repository-factory-pattern.md`)

**Format:**

```markdown
# <Rule title>

<2-5 lines: the rule, written as an instruction to Claude>

Why: <one-line reasoning>
```

**Conventions:**

- No YAML frontmatter — all learnings are global scope
- Written as an instruction to Claude, not a description of what happened
- 2-5 lines max for the rule body
- Always includes a "Why:" line explaining the reasoning
- No path-scoping — patterns apply project-wide

**Example:**

```markdown
# No repository/factory pattern

Pass `db` directly as a function argument to data access functions. Do not wrap them in classes, closures, or factory functions (e.g. `createXRepo(db)`). Top-level exported functions like `insertRawItems(db, items)` are preferred.

Why: Adds unnecessary indirection — extra lines, extra closures, no real value when most functions only need one db reference.
```

## Flow

```
Invoke /learn
    |
    v
Scan full conversation for correction signals
    |
    v
For each correction, apply 3-criteria filter
    |
    v
Discard corrections that fail any criterion
    |
    v
Read all existing .claude/rules/**/*.md
    |
    v
Deduplicate candidates against existing rules
    |
    v
Write surviving candidates to .claude/rules/learnings/<slug>.md
    |
    v
Report: list of learnings written (or "no new patterns detected")
```

## Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Trigger | Manual `/learn` | User controls when to capture learnings |
| Approval | None — writes automatically | Skill is precise enough with 3-criteria filter + dedup |
| Scope | Always global | Most patterns apply project-wide |
| CLAUDE.md | No changes | `.claude/rules/` auto-loads recursively |
| Path frontmatter | None | Simplicity; can add later if needed |
| Dedup strategy | Semantic overlap check | Prevents rule bloat from repeated corrections |

## Out of Scope

- Auto-triggering via hooks (future enhancement)
- GitHub PR review comment ingestion (separate VER task)
- Learning from orchestrate DAG mistakes (existing `harness:learn` handles this)
- Linter/hook generation from learnings (future enhancement discussed in sync)

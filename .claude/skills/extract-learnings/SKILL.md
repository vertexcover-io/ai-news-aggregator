---
name: extract-learnings
description: Scan the current session for user corrections and extract reusable code pattern learnings as rule files
---

# Extract Learnings from Session

You are analyzing this conversation to find moments where the user corrected your approach. Your goal is to extract reusable code pattern rules and save them as rule files.

## Step 1: Scan for Corrections

Go through the entire conversation and find moments where the user pushed back on your approach. Look for these correction signals:

- User explicitly told you to change something: "don't do X", "use Y instead", "remove this", "why did you add X"
- User rejected a pattern: "this is over-engineered", "keep it simple", "we don't need this abstraction"
- User redirected your approach: "no, just pass it directly", "that's not how we do it here"

Ignore these — they are NOT corrections:
- User adding new requirements: "also add LinkedIn URL"
- User clarifying scope: "only do this for pipeline"
- You self-correcting during your own reasoning
- User approving your work: "looks good", "yes"
- Normal back-and-forth discussion without a direction change

## Step 2: Apply the 3-Criteria Filter

For each correction you found, it must pass ALL 4 criteria to be a learning candidate:

1. **User-initiated** — the user told you to change, not you self-correcting
2. **About HOW code is written** — patterns, style, architecture decisions. NOT about WHAT to build (features, specific data, business requirements)
3. **Generalizable** — the lesson applies beyond the specific file or function being discussed. It is a pattern that would apply in future work.
4. **Likely to recur** — Claude would plausibly make the same mistake again in a future session without this rule. If the correction was a one-time configuration fix (e.g. changing a test script, updating a hook, fixing a specific file), it will NOT recur because the fix is already in the codebase. Only capture patterns where Claude's default behavior or instinct would lead it to repeat the mistake when writing NEW code.

Examples of recurring patterns (CAPTURE):
- "Don't use repository/factory pattern" — Claude defaults to this every time it writes data access code
- "Don't create intermediate types when a direct mapping exists" — Claude's instinct is to add extra type layers

Examples of one-time fixes (DO NOT CAPTURE):
- "Run all monorepo tests, not just one package" — the test script is now configured correctly
- "Use pre-push hook instead of pre-PR hook" — the hook is now set up, won't be rewritten
- "Add this specific URL to the source list" — done once, stays in the codebase

Discard any correction that fails even one criterion. Be strict — when in doubt, discard.

## Step 3: Deduplicate Against Existing Rules

Use the Glob tool to find all existing rule files:
```
Glob pattern: .claude/rules/**/*.md
```

Read each file using the Read tool. For each learning candidate, check if an existing rule already covers the same guidance — even if worded differently. Skip the candidate if it is already covered.

Exception: if the existing rule is vague but your candidate is more specific and actionable, keep the candidate.

## Step 4: Write Learning Files

For each surviving candidate, write a rule file to `.claude/rules/learnings/<slug>.md` using the Write tool.

**Filename:** kebab-case slug describing the pattern (e.g. `no-repository-factory-pattern.md`)

**File format — follow this exactly:**
```
# <Rule title>

<2-5 lines: the rule, written as an instruction to Claude — imperative voice>

Why: <one-line reasoning from the user's correction>
```

Rules:
- No YAML frontmatter
- Written as an instruction to Claude, not a description of what happened
- 2-5 lines max for the rule body
- Always include a "Why:" line
- Be concise and specific — avoid vague guidance

## Step 5: Report

After writing all files (or finding no new patterns), report:

If learnings were written:
- List each learning file created with its path and a one-line summary
- Example: "Created `.claude/rules/learnings/no-repository-factory-pattern.md` — pass db directly, don't use factory wrappers"

If no learnings found:
- Say: "No new pattern learnings detected in this session."

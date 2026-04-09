---
name: extract-learnings
description: Scan the current session for user corrections and extract reusable code pattern learnings as rule files
---

# Extract Learnings from Session

You are analyzing this conversation to find moments where your approach was corrected. Your goal is to extract reusable code pattern rules and save them as rule files.

## Step 0: Detect Context

Determine which context you're running in:

**Session mode** (default): You're in an interactive session with a user. There is back-and-forth conversation where the user may have corrected your approach. Proceed to Step 1 and scan the full conversation.

**Review-fix mode**: You just fixed code based on a PR review comment. The conversation contains a reviewer's feedback and the fix you applied. In this mode:
- Treat the reviewer's comment as the "correction"
- Treat the code that was changed as the "mistake"
- Skip Step 1 and go directly to Step 2 to evaluate whether the reviewer's feedback passes the 4-criteria filter

## Step 1: Scan for Corrections

Go through the entire conversation and find moments where your approach was corrected. Look for these correction signals:

- User explicitly told you to change something: "don't do X", "use Y instead", "remove this", "why did you add X"
- User rejected a pattern: "this is over-engineered", "keep it simple", "we don't need this abstraction"
- User redirected your approach: "no, just pass it directly", "that's not how we do it here"
- PR reviewer pointing out a pattern issue: "Better to do X", "This pattern is wrong", "Should be structured as Y"

Ignore these — they are NOT corrections:
- User adding new requirements: "also add LinkedIn URL"
- User clarifying scope: "only do this for pipeline"
- You self-correcting during your own reasoning
- User approving your work: "looks good", "yes"
- Normal back-and-forth discussion without a direction change

## Step 2: Apply the 4-Criteria Filter

For each correction you found, it must pass ALL 4 criteria to be a learning candidate:

1. **User-initiated** — the user or reviewer told you to change, not you self-correcting
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

## Step 3: Deduplicate and Check Contradictions Against Existing Rules

Use the Glob tool to find all existing rule files:
```
Glob pattern: .claude/rules/**/*.md
```

Read each file using the Read tool. For each learning candidate:

**Duplicate check:** Does an existing rule already cover the same guidance — even if worded differently? Skip the candidate if it is already covered. Exception: if the existing rule is vague but your candidate is more specific and actionable, keep the candidate.

**Contradiction check:** Does this candidate contradict an existing rule? For example, the new learning says "pass db as first parameter" but an existing rule says "use dependency injection, don't pass db directly." If a contradiction is found:
- Do NOT write the new rule
- Do NOT modify the existing rule
- Report the conflict in your output: "Contradiction detected: new learning '<new>' conflicts with existing rule '<path>': '<existing>'"
- In review-fix mode, reply to the PR comment explaining the contradiction so the reviewer is aware

## Step 4: Write Learning Files

For each surviving candidate (passed filter, not duplicate, not contradicting), write a rule file to `.claude/rules/learnings/<slug>.md` using the Write tool.

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

## Step 4b: Draft Enforcement Stub (if mechanically enforceable)

After writing the learning file, evaluate whether the rule it encodes is **mechanically enforceable** — detectable via AST matching, type checking, file-shape check, or literal string matching in source code.

If yes, draft a stub in the same commit:

- **AST/type-aware rules** → create `packages/eslint-plugin/src/rules/<slug>.ts` as a skeleton rule (meta block + TODO-only `create()`), plus a docs stub at `packages/eslint-plugin/docs/rules/<slug>.md` and an empty RuleTester file at `packages/eslint-plugin/tests/rules/<slug>.test.ts`. Leave a `// TODO: implement — see .claude/rules/learnings/<slug>.md` comment in the rule body.
- **File-shape / package.json / env checks** → add a stub check function under `tools/invariants/<slug>.ts` (or inside `tools/check-repo-invariants.ts` as a new named check) with a TODO linking back to the learning file.

Do NOT wire the stub into `eslint.config.mjs` or `check-repo-invariants.ts` as an active check — leave that for a human reviewer to promote once the implementation lands. The stub exists only so the next maintainer has a starting point and a breadcrumb back to the learning.

If the learning is purely behavioral (process, orchestration, testing habits, review workflow), skip this step — there is no automated check to draft.

## Step 5: Report

After writing all files (or finding no new patterns), report:

If learnings were written:
- List each learning file created with its path and a one-line summary
- Example: "Created `.claude/rules/learnings/no-repository-factory-pattern.md` — pass db directly, don't use factory wrappers"

If contradictions were found:
- List each contradiction with the conflicting rule path and a summary
- Example: "Contradiction: reviewer suggested 'pass db directly' but existing rule `.claude/rules/learnings/use-dependency-injection.md` says 'use DI, don't pass db'. No rule written."

If no learnings found:
- Say: "No new pattern learnings detected in this session."

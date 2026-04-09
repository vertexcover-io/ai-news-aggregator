<!-- invariants:allow docker -->
# Invariant scanners that grep for literal strings must split the needle to avoid self-matching

When writing a repo invariant/grep-based check that searches the codebase for a forbidden literal (e.g. forbidden tool names, `console.log`, `TODO:`), the scanner's own source file becomes a positive hit because it contains the exact literal it is looking for. The check then fails on itself and the only "fix" is to either allowlist the scanner file or launder the literal through string concatenation/escape at compile time.

Prefer splitting the needle at the source level so the literal never appears contiguously in the scanner's own bytes:

```ts
// BAD — the scanner file contains the forbidden literal verbatim and matches itself
const FORBIDDEN = "dock" + "er-compose"; // shown split here only for this doc

// GOOD — split at compile time so grep for the full literal in the source tree
// does not find it inside this file
const FORBIDDEN = "dock" + "er" + "-compose";
```

Other workable options: put the literal inside a regex with a non-capturing break (`/dock[e]r-compose/`), load the needle from a data file excluded from the scan, or keep an explicit allowlist marker (`<!-- invariants:allow ... -->`) that the scanner honors. Splitting is the cheapest and most self-explanatory for one-off constants.

Why: In the custom-eslint-plugin run, Phase 7 added a `no-docker-references` invariant to enforce podman-only tooling. The first implementation stored the forbidden literal as a plain string constant inside `tools/check-repo-invariants.ts`, and the very first run of the check failed on the scanner file itself. Any future grep-style invariant (forbidden env var names, banned imports, deprecated API strings) should plan for the self-match problem up front.

Enforced by: manual review when adding grep-based checks to `tools/check-repo-invariants.ts`

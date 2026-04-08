# Assert exact strings in tests when SPEC mandates user-visible text

When a SPEC requirement quotes specific user-visible copy (error messages, empty states, button labels, toast text), the corresponding test must assert the **exact** string from the SPEC, not a substring or a regex on a keyword. Loose matchers like `toContain("not found")` will pass even when the implementation drifts from the SPEC wording.

Rule: if a SPEC line contains text in quotes that the user will see, the test for that requirement must do a strict equality check against the same quoted string. Copy the string verbatim into the test — do not paraphrase.

Why: In the run-ui run, REQ-114 specified the empty-state copy verbatim, but the implementation shipped `"Run not found (404)"` while the SPEC required different exact text. Tests passed because they only checked for "not found"; the mismatch was caught later in code review. Exact-string assertions would have failed at TDD time and forced the fix immediately.

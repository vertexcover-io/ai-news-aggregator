# Truncation helpers with a suffix must reserve space for the suffix in the limit

When implementing a `truncate(str, maxLen)` function that appends a suffix (e.g. `"..."`), the slice boundary must account for the suffix length — otherwise the output exceeds `maxLen` by exactly `suffix.length`, silently breaking any caller that asserts `result.length <= maxLen`.

```ts
// BAD: output is maxLen + 3 characters
function truncateError(msg: string): string {
  if (msg.length <= MAX_ERROR_LENGTH) return msg;
  return msg.slice(0, MAX_ERROR_LENGTH) + "...";
}

// GOOD: output is exactly maxLen characters
function truncateError(msg: string): string {
  if (msg.length <= MAX_ERROR_LENGTH) return msg;
  return msg.slice(0, MAX_ERROR_LENGTH - 3) + "...";
}
```

The off-by-3 error is easy to introduce because the suffix is added _after_ slicing, making it look correct at a glance. Tests that only check "truncation happens" won't catch it — you need a test that asserts `result.length === MAX_ERROR_LENGTH`.

**Why:** In the tech-debt cleanup run, `truncateError` was found producing strings of `MAX_ERROR_LENGTH + 3` because the slice boundary was not adjusted for the `"..."` suffix. Any downstream code checking `error.length <= MAX_ERROR_LENGTH` would have been silently violated.

**How to apply:** Any time you write or review a truncation helper that appends a suffix, verify the slice is `maxLen - suffix.length`, not `maxLen`. Add a unit test that asserts `truncate(longString, N).length === N`.

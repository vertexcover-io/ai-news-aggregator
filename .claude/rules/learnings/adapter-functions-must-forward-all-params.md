# Adapter/bridge functions must forward every parameter their real callees accept

When a module defines an abstraction with an injected function (e.g. `fetchFn`, `httpFn`, `dbFn`) and ships a default implementation that wraps a real library call, the default wrapper MUST forward every optional parameter the abstraction accepts — especially `AbortSignal`, timeouts, and headers. Dropping a parameter in the default bridge creates a silent production-only failure: unit tests that inject a signal-honoring mock pass, but the real code path ignores the feature entirely.

```ts
// BAD: default fetchFn drops the signal; timeout is a no-op in prod
export interface FetchFn {
  (url: string, init?: { signal?: AbortSignal }): Promise<Response>;
}
const defaultFetchFn: FetchFn = (url) => fetch(url); // signal dropped!

export async function fetchMarkdown(url: string, opts: { timeoutMs: number; fetchFn?: FetchFn }) {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), opts.timeoutMs);
  return (opts.fetchFn ?? defaultFetchFn)(url, { signal: ac.signal });
}

// GOOD: default forwards init verbatim
const defaultFetchFn: FetchFn = (url, init) => fetch(url, init);
```

Red flags to check during code review of any injected-function pattern:
1. Does the default implementation accept the same parameters as the interface type?
2. Does the default forward `signal`, `headers`, and `AbortSignal`-like options to the underlying call?
3. Do any tests exercise the DEFAULT implementation path, or do all tests inject a mock? If only mocks are tested, add at least one test that uses the real default with a fake `fetch` spy to assert the signal is forwarded.

Why: In the personalized-ranking run, the rank-body-loader had a SPEC-mandated 15s per-item timeout (REQ-043) and a `timeoutMs` option, but the default `fetchFn` wrapper was `(url) => fetch(url)` — it dropped the `init` argument entirely, so the AbortController signal never reached `fetch`. Unit tests passed because they injected a mock that honored the signal. The production path was a silent no-op for the full feature. The general pattern: when the default implementation is shaped differently from how tests mock the dependency, tests lie. Always test the default path, or make the default a trivial passthrough (`(...args) => realFn(...args)`) that can never drop arguments.

# Learnings — add-post-collector-resolver

## 1. The user's stated assumption was wrong — verify the current state before scoping

The task description said: *"only the reddit and web collector as supported (I assume)."* In fact `fetchHnPost` was already wired into `dispatchFetch` and worked end-to-end. Had I taken the task at face value, I would have spent half the effort re-implementing HN.

**Rule for future scope-from-description tasks:** When the user says "X assumes Y about the current state," **verify Y first** before scoping. A 60-second `grep`/`Explore` pass before scoping prevents 30 minutes of duplicate work.

This is generalisable — added as `.claude/rules/learnings/verify-user-assumptions-before-scoping.md` candidate.

## 2. `git worktree add` + symlinked `.env*` files breaks tracked example files

I symlinked all `.env*` files from the source repo into the new worktree, including `.env.example`. `.env.example` is a **tracked file** in this repo, so the symlink replacing the tracked file showed up in `git status` as "deleted .env.example". This was only caught during code-review pass 1's `git diff --stat` check.

**Rule:** when symlinking env files into a worktree, **only symlink the gitignored ones** (`.env`, `.env.harness`, `.env.test`). Tracked example files (`.env.example`, `.env.test.example`) must NOT be symlinked — they should be left as the worktree's checked-out copy.

Worth adding to the `using-git-worktrees` skill: step 3 should distinguish "secrets to symlink" vs "tracked examples to leave alone."

## 3. Eager constructor-time auth validation in third-party SDKs

`new Rettiwt({ apiKey: bogus })` throws **synchronously at construction**, not lazily on first API call. Discovered via library-probe VS-LP-3. This caught a bug-shape in my implementation: I had to wrap `rettiwtFactory(apiKey)` in a sync try/catch, not just the awaited call.

**Rule:** when integrating a third-party SDK with an authenticated constructor, **probe the constructor's failure mode** (does it throw, or defer to first call?) before deciding where the try/catch boundary lives.

## 4. Library-probe paid off — the cookie was stale

The initial probe failed with 403 because the `.env` cookie had gone stale. The CSRF refresh + retry pattern (already in the bulk collector) was confirmed as the right pattern for the single-tweet path *before* I wrote production code that didn't include it. Without the probe, the unit tests would have been written against a happy mocked path, the e2e test would have failed mysteriously in production, and the fix would have been a follow-up PR.

**Rule already in the harness — library-probe is non-negotiable.** This run confirmed it once more.

## 5. Per-call resolver vs cached SDK constructor — different staleness contracts

The freshness contract (per `cache-vs-spec-promise-review`) applies to the **cookie value**, not to the SDK constructor or the repo handle. I memoised the latter two (which are process-stable) and re-resolve the cookie on every call. The unit test `REQ-010` explicitly observes two distinct cookie values across consecutive calls to lock this in.

This is generalisable: when caching dependencies of a function that touches user-mutable config, **separate the dependency graph into "process-stable" (cache OK) vs "user-mutable" (resolve per call)** and write a test that proves the latter.

## 6. Type-only imports across the collector / helper boundary

The `RettiwtTweetFacade` interface lives in the collector (`twitter/index.ts`) because the collector defines the contract. The helper needs the same type for type-checking the cached constructor's return value. **Import as `type`** to avoid runtime coupling — collectors are loaded lazily by the helper's dynamic imports, and a value import would defeat that.

Standard TS pattern; worth re-noting because the alternative ("duplicate the interface") drifted in an earlier attempt.

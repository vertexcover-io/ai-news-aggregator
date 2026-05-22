/**
 * Graded-relevance mapping from `design.md` §A2.
 *
 * Frozen by spec — these numeric weights drive `ndcgAtK` and must not be
 * tuned without re-validating every saved fixture score.
 */
export const TIER_RELEVANCE = { must: 3, nice: 1, drop: 0 } as const;

/** Default cutoff for nDCG@k / precision@k / mustIncludeRecall. */
export const EVAL_K = 10;

/** Default `--all` / "Run on all fixtures" window size (most recent N fixtures). */
export const WINDOW_DEFAULT = 20;

/** Hard cap for `--window N` before `--force-window` is required. */
export const WINDOW_MAX = 60;

/** Repo-relative directory of committed fixture JSON files. */
export const FIXTURES_DIR = "evals/ranking/fixtures";

/** Repo-relative directory of committed ground-truth JSON files. */
export const GROUNDTRUTH_DIR = "evals/ranking/groundtruth";

/** Repo-relative directory of (gitignored) LLM response cache files. */
export const CACHE_DIR = "evals/ranking/cache";

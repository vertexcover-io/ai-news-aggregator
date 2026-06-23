/**
 * Minimal GitHub REST client (no Octokit dependency — the repo has none).
 * Phase 1 uses {@link GithubClient.createIssue} for the human/agent lanes;
 * {@link GithubClient.dispatch} is the Phase-2 `repository_dispatch` trigger for
 * the auto-fix workflow and is implemented but not yet called.
 *
 * All methods are best-effort: they return null/false and log on failure rather
 * than throwing, so incident routing can never crash the host process.
 */

export interface GithubIssueResult {
  url: string;
  number: number;
}

export interface GithubClient {
  /** Open an issue. Returns its html_url + number, or null on failure. */
  createIssue(input: {
    title: string;
    body: string;
    labels?: string[];
  }): Promise<GithubIssueResult | null>;
  /**
   * Fire a `repository_dispatch` event (Phase 2 auto-fix trigger). Returns true
   * on the GitHub 204. The workflow keys on `event_type`.
   */
  dispatch(input: {
    eventType: string;
    clientPayload: Record<string, unknown>;
  }): Promise<boolean>;
}

export interface GithubClientConfig {
  /** PAT with `repo` (+ `workflow` for dispatch) scope. */
  token: string;
  /** `owner/name`, e.g. `vertexcover-io/ai-news-aggregator`. */
  repo: string;
  fetchFn?: typeof fetch;
  /** Optional structured logger (pino-style). */
  logger?: { warn: (obj: unknown, msg?: string) => void };
}

const API_BASE = "https://api.github.com";

export function createGithubClient(config: GithubClientConfig): GithubClient {
  const fetchFn = config.fetchFn ?? fetch;
  const headers = {
    authorization: `Bearer ${config.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
    "user-agent": "newsletter-error-tracking",
  };
  const warn = (obj: unknown, msg: string): void => {
    if (config.logger) config.logger.warn(obj, msg);
    else console.warn(`[github] ${msg}`);
  };

  return {
    async createIssue(input): Promise<GithubIssueResult | null> {
      try {
        const res = await fetchFn(`${API_BASE}/repos/${config.repo}/issues`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: input.title,
            body: input.body,
            labels: input.labels ?? [],
          }),
        });
        if (res.status !== 201) {
          warn({ status: res.status }, "createIssue non-201");
          return null;
        }
        const json = (await res.json()) as { html_url?: string; number?: number };
        if (typeof json.html_url !== "string" || typeof json.number !== "number") {
          return null;
        }
        return { url: json.html_url, number: json.number };
      } catch (err) {
        warn({ err: err instanceof Error ? err.message : String(err) }, "createIssue failed");
        return null;
      }
    },

    async dispatch(input): Promise<boolean> {
      try {
        const res = await fetchFn(`${API_BASE}/repos/${config.repo}/dispatches`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            event_type: input.eventType,
            client_payload: input.clientPayload,
          }),
        });
        if (res.status !== 204) {
          warn({ status: res.status }, "dispatch non-204");
          return false;
        }
        return true;
      } catch (err) {
        warn({ err: err instanceof Error ? err.message : String(err) }, "dispatch failed");
        return false;
      }
    },
  };
}

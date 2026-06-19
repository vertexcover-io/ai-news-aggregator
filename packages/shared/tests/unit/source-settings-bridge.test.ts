/**
 * Unit: the user_settings ⇄ sources-rows bridge helpers (REQ-073 follow-up).
 *
 * `settingsConfigsFromSourceRows` powers the GET /settings overlay (rows →
 * the 5 collector configs the Settings card renders); `sourceRowsFromSettings`
 * powers the PUT /settings reconcile (configs → per-identity row seeds). The
 * two must round-trip a tenant's collection set without drift.
 */
import { describe, it, expect } from "vitest";
import {
  settingsConfigsFromSourceRows,
  sourceRowsFromSettings,
  collectorsFromSources,
  type SourceConfig,
  type SettingsCollectorConfigs,
} from "@shared/types/source.js";

const row = (config: SourceConfig, enabled = true): { config: SourceConfig; enabled: boolean } => ({
  config,
  enabled,
});

describe("settingsConfigsFromSourceRows", () => {
  it("aggregates reddit rows into one config with all subreddits enabled", () => {
    const configs = settingsConfigsFromSourceRows([
      row({ kind: "reddit", subreddit: "videoproduction", sinceDays: 1 }),
      row({ kind: "reddit", subreddit: "streaming", sinceDays: 1 }),
      row({ kind: "reddit", subreddit: "VideoEngineering", sinceDays: 1 }),
    ]);
    expect(configs.redditEnabled).toBe(true);
    expect(configs.redditConfig).toEqual({
      subreddits: ["videoproduction", "streaming", "VideoEngineering"],
      sinceDays: 1,
    });
  });

  it("maps web-kind rows into webConfig.sources", () => {
    const configs = settingsConfigsFromSourceRows([
      row({ kind: "web", name: "castr.com", listingUrl: "https://castr.com/blog" }),
      row({ kind: "web", name: "www.wowza.com", listingUrl: "https://www.wowza.com/blog" }),
    ]);
    expect(configs.webEnabled).toBe(true);
    expect(configs.webConfig?.sources).toEqual([
      { name: "castr.com", listingUrl: "https://castr.com/blog" },
      { name: "www.wowza.com", listingUrl: "https://www.wowza.com/blog" },
    ]);
  });

  it("lifts a single hn row into hnConfig", () => {
    const configs = settingsConfigsFromSourceRows([row({ kind: "hn", sinceDays: 1 })]);
    expect(configs.hnEnabled).toBe(true);
    expect(configs.hnConfig).toEqual({ sinceDays: 1 });
  });

  it("a collector is enabled iff ANY row of that type is enabled", () => {
    const configs = settingsConfigsFromSourceRows([
      row({ kind: "reddit", subreddit: "a", sinceDays: 1 }, false),
      row({ kind: "reddit", subreddit: "b", sinceDays: 1 }, false),
    ]);
    // disabled rows still surface in the config (so re-enabling keeps them)…
    expect(configs.redditConfig?.subreddits).toEqual(["a", "b"]);
    // …but the collector toggle reads false when none are enabled.
    expect(configs.redditEnabled).toBe(false);
  });

  it("includes unresolved Twitter handles (userId \"\") — unlike collectorsFromSources", () => {
    const rows = [row({ kind: "twitter_user", handle: "tri_dao" })];
    const configs = settingsConfigsFromSourceRows(rows);
    expect(configs.twitterConfig?.users).toEqual([{ handle: "tri_dao", userId: "" }]);
    // collection drops handles with no resolved id:
    expect(collectorsFromSources(rows.map((r) => r.config)).twitter).toBeUndefined();
  });

  it("returns all-null / all-false for an empty tenant", () => {
    const configs = settingsConfigsFromSourceRows([]);
    expect(configs).toEqual({
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: false,
      webSearchConfig: null,
    });
  });
});

describe("sourceRowsFromSettings", () => {
  it("decomposes one row per subreddit, carrying the collector enabled flag", () => {
    const configs = base({
      redditEnabled: true,
      redditConfig: { subreddits: ["mlops", "LocalLLaMA"], sinceDays: 1 },
    });
    const seeds = sourceRowsFromSettings(configs);
    expect(seeds).toEqual([
      { type: "reddit", enabled: true, config: { kind: "reddit", subreddit: "mlops", sinceDays: 1 } },
      { type: "reddit", enabled: true, config: { kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 } },
    ]);
  });

  it("emits web rows as type \"blog\" and omits empty userId on twitter rows", () => {
    const configs = base({
      webEnabled: true,
      webConfig: { sources: [{ name: "castr.com", listingUrl: "https://castr.com/blog" }], maxItems: 10 },
      twitterEnabled: false,
      twitterConfig: { listIds: [], users: [{ handle: "tri_dao", userId: "" }] },
    });
    const seeds = sourceRowsFromSettings(configs);
    expect(seeds).toContainEqual({
      type: "blog",
      enabled: true,
      config: { kind: "web", name: "castr.com", listingUrl: "https://castr.com/blog", maxItems: 10 },
    });
    expect(seeds).toContainEqual({
      type: "twitter",
      enabled: false,
      config: { kind: "twitter_user", handle: "tri_dao" },
    });
  });

  it("emits at most one hn row", () => {
    const seeds = sourceRowsFromSettings(base({ hnEnabled: true, hnConfig: { sinceDays: 1 } }));
    expect(seeds).toEqual([{ type: "hn", enabled: true, config: { kind: "hn", sinceDays: 1 } }]);
  });
});

describe("round-trip (rows → configs → rows)", () => {
  it("preserves a tenant's effective collection set", () => {
    // streamscale's real onboarding rows.
    const rows: { config: SourceConfig; enabled: boolean }[] = [
      row({ kind: "reddit", subreddit: "videoproduction", sinceDays: 1 }),
      row({ kind: "reddit", subreddit: "streaming", sinceDays: 1 }),
      row({ kind: "reddit", subreddit: "VideoEngineering", sinceDays: 1 }),
      row({ kind: "web", name: "castr.com", listingUrl: "https://castr.com/blog" }),
      row({ kind: "hn", sinceDays: 1 }),
    ];
    const back = sourceRowsFromSettings(settingsConfigsFromSourceRows(rows));
    // collectorsFromSources is the collection contract — identical before/after.
    expect(collectorsFromSources(back.filter((r) => r.enabled).map((r) => r.config))).toEqual(
      collectorsFromSources(rows.filter((r) => r.enabled).map((r) => r.config)),
    );
  });
});

/** A fully-empty config set with selected overrides applied. */
function base(overrides: Partial<SettingsCollectorConfigs>): SettingsCollectorConfigs {
  return {
    hnEnabled: false,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    ...overrides,
  };
}

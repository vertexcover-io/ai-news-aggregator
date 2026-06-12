import { describe, expect, it } from "vitest";
import {
  DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND,
  TWITTER_COLLECTOR_THROTTLE_KEY,
  parseTwitterCollectorRate,
} from "@pipeline/lib/twitter-throttle.js";

describe("twitter collector throttle (REQ-068)", () => {
  it("uses one global key shared by every tenant", () => {
    expect(TWITTER_COLLECTOR_THROTTLE_KEY).toBe("throttle:twitter-collector");
  });

  it("parses TWITTER_COLLECTOR_RATE_PER_SECOND with a sane default", () => {
    expect(parseTwitterCollectorRate(undefined)).toBe(
      DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND,
    );
    expect(parseTwitterCollectorRate("")).toBe(
      DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND,
    );
    expect(parseTwitterCollectorRate("2.5")).toBe(2.5);
    expect(parseTwitterCollectorRate("0")).toBe(0); // 0 disables throttling
    expect(parseTwitterCollectorRate("junk")).toBe(
      DEFAULT_TWITTER_COLLECTOR_RATE_PER_SECOND,
    );
  });
});

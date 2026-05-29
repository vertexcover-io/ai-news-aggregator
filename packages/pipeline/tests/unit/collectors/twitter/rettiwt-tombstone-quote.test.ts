import { describe, it, expect } from "vitest";
import { Tweet } from "rettiwt-api";

// Regression for the production crash:
//   "Cannot read properties of undefined (reading 'conversation_id_str')"
//
// rettiwt-api's Tweet constructor recurses into quoted tweets via
// `_getQuotedTweet`, whose "normal tweet" branch only checks
// `quoted_status_result.result.rest_id` — NOT `.legacy`. When a tweet quotes
// another tweet that has been deleted / withheld / age-restricted, the quoted
// payload carries a `rest_id` but no `legacy` block, so the recursive
// `new Tweet(result)` throws on `tweet.legacy.conversation_id_str`. Because the
// SDK deserializes the whole timeline page atomically, one such tweet aborts the
// entire list fetch (observed in prod: a Twitter list yielded 0 items with this
// error while every other source succeeded).
//
// Flavor A fix: isolate the failure to the poisoned quote — the outer tweet must
// still deserialize, with its unreadable quoted sub-tweet dropped (quoted =
// undefined), rather than killing the page. This is enforced via a vendored
// `pnpm patch` of rettiwt-api's `_getQuotedTweet` legacy guard.

interface RawUserResult {
  rest_id: string;
  core: { screen_name: string; name: string };
  legacy: {
    description: string;
    following: boolean;
    followed_by: boolean;
    favourites_count: number;
    followers_count: number;
    friends_count: number;
    statuses_count: number;
  };
  is_blue_verified: boolean;
}

function rawUser(handle: string): RawUserResult {
  return {
    rest_id: `uid-${handle}`,
    core: { screen_name: handle, name: handle },
    legacy: {
      description: "",
      following: false,
      followed_by: false,
      favourites_count: 0,
      followers_count: 0,
      friends_count: 0,
      statuses_count: 0,
    },
    is_blue_verified: false,
  };
}

function rawTweet(id: string, handle: string, text: string): Record<string, unknown> {
  return {
    rest_id: id,
    legacy: {
      conversation_id_str: `conv-${id}`,
      created_at: "Wed May 01 00:00:00 +0000 2026",
      full_text: text,
      entities: { urls: [], user_mentions: [], hashtags: [] },
      quote_count: 0,
      reply_count: 0,
      retweet_count: 0,
      favorite_count: 0,
      bookmark_count: 0,
    },
    core: { user_results: { result: rawUser(handle) } },
  };
}

describe("rettiwt-api Tweet — quoted-tombstone resilience (Flavor A)", () => {
  it("does not throw and drops the quote when the quoted tweet has no legacy block", () => {
    // Outer tweet quotes a tombstone: rest_id present, legacy absent.
    const raw = {
      ...rawTweet("outer-1", "alice", "my hot take"),
      quoted_status_result: { result: { rest_id: "tombstone-1" } },
    };

    const tweet = new Tweet(raw);

    expect(tweet.id).toBe("outer-1");
    expect(tweet.fullText).toBe("my hot take");
    expect(tweet.tweetBy.userName).toBe("alice");
    expect(tweet.quoted).toBeUndefined();
  });

  it("still extracts a quoted tweet that DOES have a legacy block", () => {
    const raw = {
      ...rawTweet("outer-2", "bob", "quoting a real tweet"),
      quoted_status_result: { result: rawTweet("quoted-2", "carol", "the original") },
    };

    const tweet = new Tweet(raw);

    expect(tweet.id).toBe("outer-2");
    expect(tweet.quoted).toBeDefined();
    expect(tweet.quoted?.id).toBe("quoted-2");
    expect(tweet.quoted?.fullText).toBe("the original");
    expect(tweet.quoted?.tweetBy.userName).toBe("carol");
  });
});

import { describe, expect, it } from "vitest";
import {
  dedupCandidates,
  type DedupCandidate,
} from "@pipeline/processors/dedup.js";
import { computeDedupGroups } from "@pipeline/processors/dedup-groups.js";
import {
  computeDedupGroups as exportedComputeDedupGroups,
} from "@pipeline/eval-entry.js";

type TitledCandidate = DedupCandidate & {
  readonly title: string;
};

const candidate = ({
  id,
  url,
  title = `Item ${id}`,
  points = 0,
  commentCount = 0,
}: {
  readonly id: number;
  readonly url: string;
  readonly title?: string;
  readonly points?: number;
  readonly commentCount?: number;
}): TitledCandidate => ({
  id,
  url,
  title,
  engagement: { points, commentCount },
});

const survivorIdsFromDedup = (items: readonly TitledCandidate[]): Set<number> =>
  new Set(dedupCandidates(items).map((item) => item.id));

describe("computeDedupGroups", () => {
  it("REQ-009 EDGE-009: identifies the highest-engagement canonical-url survivor and loser attribution", () => {
    const items = [
      candidate({
        id: 101,
        url: "https://Example.com/posts/launch/?utm_source=rss#comments",
        title: "Lower signal copy",
        points: 10,
        commentCount: 5,
      }),
      candidate({
        id: 102,
        url: "https://example.com/posts/launch",
        title: "Winning copy",
        points: 25,
        commentCount: 3,
      }),
      candidate({
        id: 103,
        url: "https://example.com/other",
        title: "Unique story",
        points: 1,
        commentCount: 1,
      }),
    ];

    const result = computeDedupGroups(items);

    expect(result.survivorIds).toEqual(new Set([102, 103]));
    expect(result.droppedToWinner).toEqual(
      new Map([
        [
          101,
          {
            winnerId: 102,
            winnerTitle: "Winning copy",
            winnerPoints: 25,
          },
        ],
      ]),
    );
  });

  it("REQ-009: resolves equal engagement ties to the first-seen item, matching dedupCandidates", () => {
    const items = [
      candidate({
        id: 201,
        url: "https://example.com/tie",
        title: "First copy",
        points: 10,
        commentCount: 2,
      }),
      candidate({
        id: 202,
        url: "https://example.com/tie?utm_campaign=social",
        title: "Second copy",
        points: 9,
        commentCount: 3,
      }),
    ];

    const result = computeDedupGroups(items);

    expect(result.survivorIds).toEqual(new Set([201]));
    expect(result.droppedToWinner.get(202)).toEqual({
      winnerId: 201,
      winnerTitle: "First copy",
      winnerPoints: 10,
    });
  });

  it("REQ-009: survivorIds has parity with dedupCandidates across canonicalization edge cases", () => {
    const matrix: readonly (readonly TitledCandidate[])[] = [
      [],
      [
        candidate({
          id: 301,
          url: "https://EXAMPLE.com/story/?utm_source=feed&keep=1#section",
          points: 1,
        }),
        candidate({
          id: 302,
          url: "https://example.com/story?keep=1",
          points: 3,
        }),
      ],
      [
        candidate({ id: 401, url: "not-a-url", points: 1 }),
        candidate({ id: 402, url: "not-a-url", points: 2 }),
        candidate({ id: 403, url: "also-not-a-url", points: 1 }),
      ],
      [
        candidate({ id: 501, url: "https://example.com/a", points: 4 }),
        candidate({ id: 502, url: "https://example.com/b", points: 3 }),
        candidate({ id: 503, url: "https://example.com/a?ref=x", points: 1 }),
      ],
      [
        candidate({ id: 601, url: "https://example.com/tie", points: 2 }),
        candidate({
          id: 602,
          url: "https://example.com/tie?utm_medium=email",
          points: 2,
        }),
      ],
    ];

    for (const items of matrix) {
      expect(computeDedupGroups(items).survivorIds).toEqual(
        survivorIdsFromDedup(items),
      );
    }
  });

  it("REQ-016: re-exports the helper from the eval entrypoint", () => {
    const items = [
      candidate({ id: 701, url: "https://example.com/export", points: 1 }),
      candidate({
        id: 702,
        url: "https://example.com/export?utm_source=feed",
        points: 2,
      }),
    ];

    expect(exportedComputeDedupGroups(items).survivorIds).toEqual(
      new Set([702]),
    );
  });
});

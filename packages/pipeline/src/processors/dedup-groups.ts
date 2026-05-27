import {
  canonicalizeUrl,
  type DedupCandidate,
} from "@pipeline/processors/dedup.js";

export interface DedupGroupItem extends DedupCandidate {
  readonly title: string;
}

export interface DedupGroupResult {
  survivorIds: Set<number>;
  droppedToWinner: Map<
    number,
    { winnerId: number; winnerTitle: string; winnerPoints: number }
  >;
}

interface DedupGroup {
  readonly winner: DedupGroupItem;
  readonly winnerScore: number;
  readonly members: readonly DedupGroupItem[];
}

const engagementScore = (item: DedupCandidate): number =>
  item.engagement.points + item.engagement.commentCount;

const updateGroup = ({
  group,
  item,
}: {
  readonly group: DedupGroup | undefined;
  readonly item: DedupGroupItem;
}): DedupGroup => {
  const itemScore = engagementScore(item);
  if (!group) {
    return { winner: item, winnerScore: itemScore, members: [item] };
  }

  const isNewWinner = itemScore > group.winnerScore;
  return {
    winner: isNewWinner ? item : group.winner,
    winnerScore: isNewWinner ? itemScore : group.winnerScore,
    members: [...group.members, item],
  };
};

export function computeDedupGroups(items: readonly DedupGroupItem[]): DedupGroupResult {
  const groups = new Map<string, DedupGroup>();
  for (const item of items) {
    const key = canonicalizeUrl(item.url);
    groups.set(key, updateGroup({ group: groups.get(key), item }));
  }

  const survivorIds = new Set<number>();
  const droppedToWinner = new Map<
    number,
    { winnerId: number; winnerTitle: string; winnerPoints: number }
  >();

  for (const group of groups.values()) {
    survivorIds.add(group.winner.id);
    for (const item of group.members) {
      if (item.id === group.winner.id) continue;
      droppedToWinner.set(item.id, {
        winnerId: group.winner.id,
        winnerTitle: group.winner.title,
        winnerPoints: group.winner.engagement.points,
      });
    }
  }

  return { survivorIds, droppedToWinner };
}

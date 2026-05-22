import type { ReactElement } from "react";
import type {
  FixtureItem,
  Tier,
} from "@newsletter/shared/types/eval-ranking";

export interface ClusterRowProps {
  cluster: { representative: FixtureItem; duplicateCount: number };
  currentLabel: Tier | undefined;
  expanded: boolean;
  selected: boolean;
  onLabel: (tier: Tier) => void;
  onExpand: () => void;
}

const TIER_STYLES: Record<Tier, string> = {
  must: "bg-emerald-100 text-emerald-800 border-emerald-300",
  nice: "bg-amber-100 text-amber-800 border-amber-300",
  drop: "bg-rose-100 text-rose-800 border-rose-300",
};

function formatAge(publishedAt: string | null): string {
  if (publishedAt === null) return "unknown";
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return "unknown";
  const diffMs = Date.now() - t;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "<1h ago";
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function ClusterRow(props: ClusterRowProps): ReactElement {
  const {
    cluster: { representative, duplicateCount },
    currentLabel,
    expanded,
    selected,
    onLabel,
    onExpand,
  } = props;
  const ogImage = representative.enrichedLink?.imageUrl;
  const description = representative.enrichedLink?.description;

  return (
    <article
      data-testid={`cluster-row-${String(representative.rawItemId)}`}
      data-selected={selected ? "true" : "false"}
      aria-selected={selected}
      className={`flex flex-col gap-2 border rounded-md px-4 py-3 transition-colors ${
        selected
          ? "border-amber-500 bg-amber-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        {ogImage !== undefined && ogImage.length > 0 ? (
          <img
            src={ogImage}
            alt=""
            className="w-16 h-16 object-cover rounded shrink-0"
          />
        ) : null}
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold leading-snug">
            {representative.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <span className="rounded-sm border border-gray-300 px-1.5 py-0.5 font-mono uppercase tracking-wide">
              {representative.sourceType}
            </span>
            <span>{formatAge(representative.publishedAt)}</span>
            {duplicateCount > 0 ? (
              <span className="rounded-sm bg-gray-100 px-1.5 py-0.5">
                +{String(duplicateCount)} duplicate
                {duplicateCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {currentLabel !== undefined ? (
              <span
                data-testid={`label-chip-${String(representative.rawItemId)}`}
                className={`rounded-sm border px-1.5 py-0.5 uppercase tracking-wide font-semibold ${TIER_STYLES[currentLabel]}`}
              >
                {currentLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {expanded && description !== undefined && description.length > 0 ? (
        <p
          data-testid={`description-${String(representative.rawItemId)}`}
          className="text-sm text-gray-700"
        >
          {description}
        </p>
      ) : null}
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            onLabel("must");
          }}
          className="rounded border border-emerald-300 bg-white px-2 py-1 hover:bg-emerald-50"
        >
          1 · must
        </button>
        <button
          type="button"
          onClick={() => {
            onLabel("nice");
          }}
          className="rounded border border-amber-300 bg-white px-2 py-1 hover:bg-amber-50"
        >
          2 · nice
        </button>
        <button
          type="button"
          onClick={() => {
            onLabel("drop");
          }}
          className="rounded border border-rose-300 bg-white px-2 py-1 hover:bg-rose-50"
        >
          3 · drop
        </button>
        <button
          type="button"
          onClick={onExpand}
          className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
        >
          space · {expanded ? "collapse" : "expand"}
        </button>
      </div>
    </article>
  );
}

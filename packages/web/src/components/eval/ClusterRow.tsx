import type { ReactElement } from "react";
import type {
  FixtureItem,
  Tier,
} from "@newsletter/shared/types/eval-ranking";

export interface ClusterRowProps {
  index: number;
  cluster: { representative: FixtureItem; duplicateCount: number };
  currentLabel: Tier | undefined;
  expanded: boolean;
  selected: boolean;
  onLabel: (tier: Tier) => void;
  onExpand: () => void;
  onSelect: () => void;
}

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

function sourceCode(sourceType: string): string {
  const s = sourceType.toLowerCase();
  if (s.startsWith("hn")) return "HN";
  if (s.startsWith("red")) return "RED";
  if (s.startsWith("tw") || s === "twitter" || s === "x") return "TW";
  if (s.startsWith("gh") || s.startsWith("github")) return "GH";
  if (s.startsWith("arx")) return "ARX";
  if (s.includes("web")) return "WEB";
  return s.slice(0, 3).toUpperCase();
}

function sourceTint(code: string): string {
  switch (code) {
    case "HN":
      return "#8c3a1e";
    case "RED":
      return "#ea580c";
    case "TW":
      return "#0369a1";
    case "GH":
      return "#166534";
    case "ARX":
      return "#92400e";
    default:
      return "#78716c";
  }
}

function PlaceholderThumb({ code }: { code: string }): ReactElement {
  const color = sourceTint(code);
  return (
    <div
      className="w-16 h-16 rounded-md border border-stone-200 flex items-center justify-center font-mono text-[10px]"
      style={{ background: `${color}1a`, color }}
      aria-hidden="true"
    >
      {code}
    </div>
  );
}

const TIER_KEY: Record<1 | 2 | 3, Tier> = {
  1: "must",
  2: "nice",
  3: "drop",
};

const TIER_LABEL: Record<Tier, string> = {
  must: "Must",
  nice: "Nice",
  drop: "Drop",
};

interface TierTileProps {
  num: 1 | 2 | 3;
  selected: boolean;
  onClick: () => void;
}

function TierTile({ num, selected, onClick }: TierTileProps): ReactElement {
  const tier = TIER_KEY[num];
  const baseClasses =
    "inline-flex flex-col items-center justify-center gap-0.5 w-14 h-14 border rounded-md transition-colors";
  let styleClasses = "border-stone-300 bg-white hover:border-stone-900 hover:bg-stone-50";
  if (selected) {
    if (tier === "must") {
      styleClasses =
        "border-emerald-700 bg-[#f0fdf4] text-emerald-800";
    } else if (tier === "nice") {
      styleClasses = "border-amber-600 bg-[#fefce8] text-amber-700";
    } else {
      styleClasses = "border-stone-500 bg-stone-100 text-stone-700";
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`${baseClasses} ${styleClasses}`}
    >
      <span
        className={`font-mono text-sm font-medium ${
          selected ? "" : "text-stone-900"
        }`}
      >
        {String(num)}
      </span>
      <span
        className={`font-mono text-[9px] uppercase tracking-[0.1em] ${
          selected ? "" : "text-stone-500"
        }`}
      >
        {TIER_LABEL[tier]}
      </span>
    </button>
  );
}

export function ClusterRow(props: ClusterRowProps): ReactElement {
  const {
    index,
    cluster: { representative, duplicateCount },
    currentLabel,
    expanded,
    selected,
    onLabel,
    onExpand,
    onSelect,
  } = props;
  const ogImage = representative.enrichedLink?.imageUrl;
  const description = representative.enrichedLink?.description;
  const engagement = representative.engagement;
  const code = sourceCode(representative.sourceType);

  let rowTint = "bg-white";
  if (currentLabel === "must") rowTint = "bg-[#f0fdf4]";
  else if (currentLabel === "nice") rowTint = "bg-[#fefce8]";
  else if (currentLabel === "drop") rowTint = "bg-stone-50";
  else if (selected) rowTint = "bg-[#fcfbfa]";

  const engagementText =
    engagement === null
      ? null
      : `${String(engagement.points)} pts · ${String(
          engagement.commentCount,
        )} comments`;

  return (
    <article
      data-testid={`cluster-row-${String(representative.rawItemId)}`}
      data-selected={selected ? "true" : "false"}
      aria-selected={selected}
      onClick={onSelect}
      className={`relative grid grid-cols-[48px_64px_1fr_220px] items-start gap-4 px-5 py-4 border-b border-stone-200 last:border-b-0 hover:bg-stone-50 transition-colors ${rowTint}`}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#8c3a1e]"
        />
      ) : null}

      <div className="pt-1 text-right font-mono text-[11px] text-stone-400 tracking-wider">
        {String(index + 1).padStart(2, "0")}
      </div>

      {ogImage !== undefined && ogImage.length > 0 ? (
        <img
          src={ogImage}
          alt=""
          className="w-16 h-16 object-cover border border-stone-200 rounded-md"
        />
      ) : (
        <PlaceholderThumb code={code} />
      )}

      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-2 font-mono text-[11px] text-stone-500">
          <span className="rounded-sm border border-stone-300 px-1.5 py-0.5 uppercase tracking-wide">
            {representative.sourceType}
          </span>
          <span>{formatAge(representative.publishedAt)}</span>
          {duplicateCount > 0 ? (
            <span className="rounded-sm bg-stone-100 px-1.5 py-0.5">
              +{String(duplicateCount)} dup{duplicateCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {engagementText !== null ? <span>{engagementText}</span> : null}
        </div>
        <h3 className="text-[15px] font-medium leading-snug text-stone-900 mb-2">
          {representative.title}
        </h3>
        <div className="font-mono text-[11px] text-stone-500 overflow-hidden text-ellipsis whitespace-nowrap">
          {representative.url}
        </div>
        {expanded && description !== undefined && description.length > 0 ? (
          <div
            data-testid={`description-${String(representative.rawItemId)}`}
            className="mt-3 pt-3 border-t border-stone-200 text-[13px] text-stone-600 leading-relaxed"
          >
            {description}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 justify-end">
        <TierTile
          num={1}
          selected={currentLabel === "must"}
          onClick={() => {
            onLabel("must");
          }}
        />
        <TierTile
          num={2}
          selected={currentLabel === "nice"}
          onClick={() => {
            onLabel("nice");
          }}
        />
        <TierTile
          num={3}
          selected={currentLabel === "drop"}
          onClick={() => {
            onLabel("drop");
          }}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="sr-only"
        >
          {expanded ? "collapse" : "expand"}
        </button>
        {currentLabel !== undefined ? (
          <span
            data-testid={`label-chip-${String(representative.rawItemId)}`}
            className="sr-only"
          >
            {currentLabel}
          </span>
        ) : null}
      </div>
    </article>
  );
}

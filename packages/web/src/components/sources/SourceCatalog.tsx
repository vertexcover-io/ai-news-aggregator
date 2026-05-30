import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { sourceTypeLabel } from "./sourceCatalogUtils";

export type SourceCatalogVariant = "page" | "menu";

export interface SourceCatalogRow {
  id: string;
  displayName: string;
  url?: string | null;
  meta?: string | null;
  count?: number;
  selected?: boolean;
  onSelect?: () => void;
}

export interface SourceCatalogSection {
  sourceType: string;
  label?: string;
  countLabel?: string;
  rows: SourceCatalogRow[];
}

function PageRow({ row, sourceType }: { row: SourceCatalogRow; sourceType: string }): ReactElement {
  const isQuery = sourceType === "web_search";
  const nameClass = cn(
    "font-serif text-[16px] font-medium leading-[1.3] text-[#14110d] hover:text-[#8c3a1e]",
    isQuery && "italic",
  );

  const name =
    row.url !== null && row.url !== undefined && row.url.length > 0 ? (
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        className={nameClass}
      >
        {row.displayName}
      </a>
    ) : (
      <span className={nameClass}>{row.displayName}</span>
    );

  return (
    <div
      data-source-row="true"
      className="grid grid-cols-[1fr_auto] items-baseline gap-4 py-2.5"
    >
      {name}
      <span className="font-mono text-[11.5px] text-[#a39a86]">
        {row.meta ?? ""}
      </span>
    </div>
  );
}

function MenuRow({ row }: { row: SourceCatalogRow }): ReactElement {
  return (
    <button
      type="button"
      onClick={row.onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-xs hover:bg-gray-50",
        row.selected && "bg-blue-50 font-medium text-blue-700",
      )}
    >
      <span className="min-w-0 truncate text-left">{row.displayName}</span>
      {row.count !== undefined && (
        <span className="shrink-0 tabular-nums text-gray-400">{row.count}</span>
      )}
    </button>
  );
}

export function SourceCatalog({
  sections,
  variant,
  emptyMessage = "No sources found",
}: {
  sections: SourceCatalogSection[];
  variant: SourceCatalogVariant;
  emptyMessage?: string;
}): ReactElement {
  if (sections.length === 0) {
    return (
      <p
        className={cn(
          variant === "page"
            ? "py-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]"
            : "px-2 py-1 text-xs text-gray-400",
        )}
      >
        {emptyMessage}
      </p>
    );
  }

  if (variant === "menu") {
    return (
      <>
        {sections.map((section) => (
          <div key={section.sourceType} className="mb-1">
            <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {section.label ?? sourceTypeLabel(section.sourceType)}
            </div>
            {section.rows.map((row) => (
              <MenuRow key={row.id} row={row} />
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {sections.map((section) => (
        <section key={section.sourceType} className="pt-6">
          <div className="flex items-baseline justify-between gap-4 border-b border-[#8c3a1e] pb-1">
            <h2 className="m-0 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
              {section.label ?? sourceTypeLabel(section.sourceType)}
            </h2>
            {section.countLabel !== undefined && (
              <span className="font-mono text-[10.5px] tabular-nums text-[#a39a86]">
                {section.countLabel}
              </span>
            )}
          </div>
          <div className="mt-1 divide-y divide-[#efeadd]">
            {section.rows.map((row) => (
              <PageRow
                key={row.id}
                row={row}
                sourceType={section.sourceType}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

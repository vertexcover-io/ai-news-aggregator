import type { ReactElement } from "react";

export interface RunsPaginationProps {
  page: number;
  pageCount: number;
  total: number;
  perPage: number;
  onPageChange: (page: number) => void;
}

function buildPageList(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const result: (number | "…")[] = [];
  const showLeftEllipsis = page > 3;
  const showRightEllipsis = page < pageCount - 2;
  result.push(1);
  if (showLeftEllipsis) result.push("…");
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  for (let i = start; i <= end; i += 1) result.push(i);
  if (showRightEllipsis) result.push("…");
  result.push(pageCount);
  return result;
}

export function RunsPagination({
  page,
  pageCount,
  total,
  perPage,
  onPageChange,
}: RunsPaginationProps): ReactElement {
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  const pages = buildPageList(page, Math.max(1, pageCount));

  return (
    <nav
      className="flex items-center justify-between rounded-b-lg border border-t-0 border-neutral-200 bg-white px-5 py-4"
      data-testid="runs-pagination"
    >
      <span className="font-mono text-[11px] text-neutral-500">
        Showing {String(start)}–{String(end)} of {String(total)}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="runs-pagination-prev"
          disabled={page <= 1}
          onClick={() => {
            onPageChange(page - 1);
          }}
          className="h-7 min-w-7 rounded-sm border border-neutral-300 bg-white px-2 font-mono text-[11px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ←
        </button>
        {pages.map((p, idx) => {
          if (p === "…") {
            return (
              <span
                key={`ellipsis-${String(idx)}`}
                className="px-1 font-mono text-[11px] text-neutral-400"
              >
                …
              </span>
            );
          }
          const isCurrent = p === page;
          return (
            <button
              key={p}
              type="button"
              data-testid={`runs-pagination-page-${String(p)}`}
              onClick={() => {
                onPageChange(p);
              }}
              className={`h-7 min-w-7 rounded-sm border px-2 font-mono text-[11px] ${
                isCurrent
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
              }`}
            >
              {String(p)}
            </button>
          );
        })}
        <button
          type="button"
          data-testid="runs-pagination-next"
          disabled={page >= pageCount}
          onClick={() => {
            onPageChange(page + 1);
          }}
          className="h-7 min-w-7 rounded-sm border border-neutral-300 bg-white px-2 font-mono text-[11px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          →
        </button>
      </div>
    </nav>
  );
}

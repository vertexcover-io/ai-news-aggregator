import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Newspaper } from "lucide-react";
import { useEvalRuns } from "../hooks/useEvalRuns";
import { RunsFilterBar } from "../components/eval/RunsFilterBar";
import { RunsTable } from "../components/eval/RunsTable";
import { RunsPagination } from "../components/eval/RunsPagination";

export function EvalRunsPage(): ReactElement {
  const {
    filter,
    setFilter,
    page,
    perPage,
    setPage,
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useEvalRuns();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  const total = data?.total ?? 0;
  const runs = data?.runs ?? [];
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const selectedCount = selectedIds.size;

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = (): void => {
    setSelectedIds(new Set<string>());
  };

  const armed = selectedCount === 2;
  const compareBarLabel =
    selectedCount === 0
      ? `0 of ${String(total)} selected — pick two runs to compare prompts`
      : `${String(selectedCount)} of ${String(total)} ${selectedCount === 1 ? "run" : "runs"} selected — ${armed ? "compare prompts side by side" : "pick one more to compare"}`;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 font-semibold"
        >
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <Link
          to="/admin/eval"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
        >
          <ArrowLeft className="size-4" />
          Back to eval
        </Link>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 md:p-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
              Eval · Run history
            </div>
            <h1 className="mt-1 font-serif text-4xl tracking-tight text-neutral-900">
              Past runs
            </h1>
            <p className="mt-2 max-w-xl text-sm text-neutral-600">
              Every scored eval lands here. Persisted across server restarts.
              Pick two runs to diff their prompts side by side.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/admin/eval"
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              ← Back to eval
            </Link>
            <Link
              to="/admin/eval"
              data-testid="runs-new-run-link"
              className="inline-flex items-center gap-1 rounded-md bg-[#8c3a1e] px-3 py-1.5 text-sm text-white hover:bg-[#7a3219]"
            >
              + New run
            </Link>
          </div>
        </div>

        <RunsFilterBar value={filter} onChange={setFilter} total={total} />

        <div
          data-testid="runs-compare-bar"
          data-armed={armed ? "true" : "false"}
          className={`mb-5 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
            armed
              ? "border-[#e2c4b6] bg-[#fbf2ee]"
              : "border-neutral-200 bg-white"
          }`}
        >
          <div
            className={`font-mono text-[11px] uppercase tracking-wider ${
              armed ? "text-[#8c3a1e]" : "text-neutral-500"
            }`}
          >
            {compareBarLabel}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="runs-compare-clear"
              onClick={clearSelection}
              disabled={selectedCount === 0}
              className="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear selection
            </button>
            <button
              type="button"
              data-testid="runs-compare-cta"
              disabled
              className="rounded-md bg-[#8c3a1e] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compare prompts →
            </button>
          </div>
        </div>

        {isError ? (
          <div
            data-testid="runs-error-block"
            className="rounded-lg border border-red-200 bg-red-50 p-4"
          >
            <div className="font-mono text-xs uppercase tracking-wider text-red-700">
              Failed to load eval runs
            </div>
            <p className="mt-1 text-sm text-red-800">
              {error?.message ?? "Unknown error"}
            </p>
            <button
              type="button"
              data-testid="runs-error-retry"
              onClick={refetch}
              className="mt-3 inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div
            data-testid="runs-loading"
            className="rounded-lg border border-neutral-200 bg-white p-8 text-center font-mono text-xs uppercase tracking-wider text-neutral-500"
          >
            Loading runs…
          </div>
        ) : total === 0 ? (
          <div
            data-testid="runs-empty-state"
            className="rounded-lg border border-dashed border-neutral-300 bg-white p-12 text-center"
          >
            <h2 className="font-serif text-2xl text-neutral-900">
              No eval runs yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600">
              Once you run a Mode A or Mode B eval, it'll be persisted here so
              you can diff prompts and compare scores over time.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Link
                to="/admin/eval"
                className="inline-flex items-center rounded-md bg-[#8c3a1e] px-3 py-1.5 text-sm text-white hover:bg-[#7a3219]"
              >
                Run your first eval
              </Link>
              <Link
                to="/admin/eval/fixtures/new"
                className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                + New fixture
              </Link>
            </div>
          </div>
        ) : (
          <>
            <RunsTable
              runs={runs}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onRowClick={() => {
                // TODO(P3): open RunDetailDrawer
              }}
              onHashClick={() => {
                // TODO(P3): open RunDetailDrawer at snapshot tab
              }}
            />
            <RunsPagination
              page={page}
              pageCount={pageCount}
              total={total}
              perPage={perPage}
              onPageChange={setPage}
            />
          </>
        )}
      </main>
    </div>
  );
}

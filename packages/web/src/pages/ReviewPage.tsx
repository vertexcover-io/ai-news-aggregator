import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useReview } from "../hooks/useReview";
import { patchArchive, promoteItem } from "../api/archives";
import { ReviewList } from "../components/review/ReviewList";
import { AddPostPanel } from "../components/review/AddPostPanel";
import { SaveBar } from "../components/review/SaveBar";
import { PoolSection } from "../components/review/PoolSection";

function formatHeading(startedAt: string | null | undefined): string {
  if (!startedAt) return "Review";
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return "Review";
  const formatted = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `Review · ${formatted}`;
}

export function ReviewPage(): ReactElement {
  const { runId = "" } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const {
    query,
    state,
    isDirty,
    reorder,
    remove,
    addPending,
    resolvePending,
    failPending,
    addPromotePending,
    resolvePromotePending,
    failPromotePending,
    discard,
    hasUrl,
    updateItemField,
  } = useReview(runId);
  const [saving, setSaving] = useState(false);
  const [promotingIds, setPromotingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [failedPromotes, setFailedPromotes] = useState<
    Map<string, { rawItemId: number; title: string }>
  >(() => new Map());

  async function handlePromote(
    rawItemId: number,
    title: string,
  ): Promise<void> {
    const tempId = `promote-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    addPromotePending({ tempId, rawItemId, title });
    setPromotingIds((prev) => {
      const next = new Set(prev);
      next.add(rawItemId);
      return next;
    });
    try {
      const item = await promoteItem(runId, { rawItemId });
      resolvePromotePending(tempId, item);
      // Keep rawItemId in promotingIds so PoolSection continues to filter it out
    } catch {
      failPromotePending(tempId);
      // Keep rawItemId in promotingIds — item stays hidden from pool on failure too
      setFailedPromotes((prev) => {
        const next = new Map(prev);
        next.set(tempId, { rawItemId, title });
        return next;
      });
    }
  }

  function handleRetryPromote(
    tempId: string,
    rawItemId: number,
    title: string,
  ): void {
    setFailedPromotes((prev) => {
      const next = new Map(prev);
      next.delete(tempId);
      return next;
    });
    void handlePromote(rawItemId, title);
  }

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!isDirty) return false;
    return currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      if (!isDirty) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const confirmed = window.confirm(
      "You have unsaved changes. Leave anyway?",
    );
    if (confirmed) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const unsavedCount = useMemo(() => {
    const initialIds = state.initial.map((i) => i.id);
    const currentIds = state.current.map((i) => i.id);
    const initialSet = new Set(initialIds);
    const currentSet = new Set(currentIds);
    let added = 0;
    let removed = 0;
    for (const id of currentIds) if (!initialSet.has(id)) added += 1;
    for (const id of initialIds) if (!currentSet.has(id)) removed += 1;
    const kept = currentIds.filter((id) => initialSet.has(id));
    const keptInitialOrder = initialIds.filter((id) => currentSet.has(id));
    const reordered = kept.some((id, i) => keptInitialOrder[i] !== id) ? 1 : 0;
    const initialMap = new Map(state.initial.map((i) => [i.id, i]));
    const fieldEdits = state.current.filter((it) => {
      const orig = initialMap.get(it.id);
      if (!orig) return false;
      if (it.title !== orig.title) return true;
      if (it.imageUrl !== orig.imageUrl) return true;
      if (it.recap?.summary !== orig.recap?.summary) return true;
      if (it.recap?.bottomLine !== orig.recap?.bottomLine) return true;
      const ab = it.recap?.bullets ?? [];
      const bb = orig.recap?.bullets ?? [];
      if (ab.length !== bb.length) return true;
      return ab.some((b, i) => b !== bb[i]);
    }).length;
    return added + removed + reordered + state.pending.length + state.pendingPromotes.length + fieldEdits;
  }, [state]);

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (query.data === null || query.data === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <p className="text-gray-700">This run was not found.</p>
          <Link to="/admin" className="text-sm text-blue-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (query.data.status !== "completed") {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <p className="text-gray-700">
            This run is still in progress — check back once it finishes.
          </p>
          <Link to="/admin" className="text-sm text-blue-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const canSave =
    state.current.length > 0 &&
    state.pending.length === 0 &&
    state.pendingPromotes.length === 0 &&
    !saving;

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await patchArchive(runId, {
        rankedItems: state.current.map((it) => ({
          id: it.id,
          sourceType: it.sourceType,
          title: it.title,
          ...(it.recap !== null && {
            summary: it.recap.summary,
            bullets: it.recap.bullets,
            bottomLine: it.recap.bottomLine,
          }),
          imageUrl: it.imageUrl,
        })),
      });
      void navigate(`/archive/${runId}`);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to save archive";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="border-b bg-white px-4 sm:px-6 md:px-8 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">📰</span> Newsletter
        </h1>
        <Link
          to="/admin"
          className="inline-flex items-center min-h-[44px] px-4 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to dashboard
        </Link>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">
              {formatHeading(query.data.startedAt)}
            </h2>
            {query.data.isDryRun === true ? (
              <span
                className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700"
                data-testid="dry-run-pill"
              >
                Dry run
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Remove, reorder, or add posts before the archive renders.
          </p>
        </div>
        <AddPostPanel
          runId={runId}
          hasUrl={hasUrl}
          onPending={addPending}
          onResolved={resolvePending}
          onFailed={failPending}
        />
        <div className="text-xs text-muted-foreground">
          {state.current.length} posts · Drag to reorder · Top to bottom = most
          important first
        </div>
        <ReviewList
          items={state.current}
          addedIds={state.addedIds}
          onReorder={reorder}
          onDelete={remove}
          onUpdateField={updateItemField}
          pendingCount={state.pending.length}
          pendingPromotes={state.pendingPromotes}
          failedPromotes={failedPromotes}
          onRetryPromote={handleRetryPromote}
        />
        <PoolSection
          runId={runId}
          isSaveInFlight={saving}
          onPromote={handlePromote}
          promotingIds={promotingIds}
          startedAt={query.data.startedAt}
          sourceTypes={query.data.sourceTypes ?? null}
        />
      </main>
      <SaveBar
        unsavedCount={unsavedCount}
        saving={saving}
        canSave={canSave}
        onSave={() => {
          void handleSave();
        }}
        onDiscard={discard}
      />
    </div>
  );
}

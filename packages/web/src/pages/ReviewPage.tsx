import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { buildLinkedinPostBody } from "@newsletter/shared/constants";
import { useReview } from "../hooks/useReview";
import { useReviewFilters } from "../hooks/useReviewFilters";
import { useSourceFacets } from "../hooks/useSourceFacets";
import { patchArchive, promoteItem } from "../api/archives";
import { ReviewList } from "../components/review/ReviewList";
import { AddPostPanel } from "../components/review/AddPostPanel";
import { DigestMetaPanel } from "../components/review/DigestMetaPanel";
import { SaveBar } from "../components/review/SaveBar";
import { PoolSection } from "../components/review/PoolSection";

function formatHeading(
  startedAt: string | null | undefined,
  isEdit: boolean,
): string {
  const prefix = isEdit ? "Edit" : "Review";
  if (!startedAt) return prefix;
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return prefix;
  const formatted = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${prefix} · ${formatted}`;
}

interface ReviewStateItem {
  id: number;
  title: string;
  imageUrl: string | null | undefined;
  recap?: { summary?: string; bottomLine?: string; bullets?: string[] } | null;
}

interface ReviewState {
  initial: ReviewStateItem[];
  current: ReviewStateItem[];
  pending: unknown[];
  pendingPromotes: unknown[];
}

interface DigestMetaValues {
  headline: string;
  summary: string;
  hook: string;
  twitterSummary: string;
  linkedinPostBody: string;
}

/** Pure helper: returns true if any of the five digest fields differ between a and b. */
export function digestMetaChanged(
  a: DigestMetaValues,
  b: DigestMetaValues,
): boolean {
  return (
    a.headline !== b.headline ||
    a.summary !== b.summary ||
    a.hook !== b.hook ||
    a.twitterSummary !== b.twitterSummary ||
    a.linkedinPostBody !== b.linkedinPostBody
  );
}

export function computeUnsavedCount(state: ReviewState): number {
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
    reset,
    hasUrl,
    updateItemField,
  } = useReview(runId);
  const [saving, setSaving] = useState(false);
  const emptyDigest: DigestMetaValues = {
    headline: "",
    summary: "",
    hook: "",
    twitterSummary: "",
    linkedinPostBody: "",
  };
  const [digestMeta, setDigestMeta] = useState(emptyDigest);
  // Baseline snapshot — set at hydration and after successful save.
  // Digest is dirty when digestBaseline is non-null and digestMeta differs from it.
  const [digestBaseline, setDigestBaseline] = useState<DigestMetaValues | null>(null);
  const [digestHydratedId, setDigestHydratedId] = useState<string | null>(null);
  // Signature (ordered list of ranked-item ids) at the time the digest meta
  // was last in sync with the ranked list — either when the archive loaded
  // or when the user clicked Regenerate. If `current` drifts from this, the
  // operator must regenerate before saving.
  const [regenSignature, setRegenSignature] = useState<string | null>(null);
  // Track the signature at the time of the last Regenerate failure.
  // regenFailed = (lastFailedSignature === currentSignature).
  // When the user reorders again (signature changes), gate re-engages automatically.
  const [lastFailedSignature, setLastFailedSignature] = useState<string | null>(null);
  const [promotingIds, setPromotingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [failedPromotes, setFailedPromotes] = useState<
    Map<string, { rawItemId: number; title: string }>
  >(() => new Map());
  const allowSaveNavigation = useRef(false);

  const filters = useReviewFilters();
  const {
    facets,
    isLoading: facetsLoading,
    isError: facetsError,
    refetch: retryFacets,
  } = useSourceFacets(runId);

  const shortlistedItemIds = query.data?.shortlistedItemIds ?? null;

  // Render-time hydration of the digest-meta fields when the completed archive
  // arrives (mirrors useReview's ranked-items hydration pattern).
  const digestCompletedKey =
    query.data?.status === "completed" ? query.data.id : null;
  if (digestCompletedKey !== null && digestCompletedKey !== digestHydratedId) {
    const storedBody = query.data?.linkedinPostBody ?? null;
    const seededBody =
      storedBody !== null && storedBody !== ""
        ? storedBody
        : buildLinkedinPostBody(
            query.data?.hook ?? null,
            (query.data?.rankedItems ?? []).map((it) => ({
              summary: it.recap?.summary ?? "",
            })),
          );
    const hydratedValues: DigestMetaValues = {
      headline: query.data?.digestHeadline ?? "",
      summary: query.data?.digestSummary ?? "",
      hook: query.data?.hook ?? "",
      twitterSummary: query.data?.twitterSummary ?? "",
      linkedinPostBody: seededBody,
    };
    setDigestMeta(hydratedValues);
    setDigestBaseline(hydratedValues);
    setDigestHydratedId(digestCompletedKey);
    const initialIds = (query.data?.rankedItems ?? []).map((i) => i.id).join("|");
    setRegenSignature(initialIds);
  }

  function handleRemove(id: number): void {
    remove(id);
    // If this item was promoted during this session, remove it from promotingIds
    // so PoolSection stops filtering it out (item returns to pool without reload).
    setPromotingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

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

  // digest dirty: non-null baseline and any field differs from it
  const digestDirty =
    digestBaseline !== null && digestMetaChanged(digestBaseline, digestMeta);

  // effective dirty combines ranked-list dirty and digest dirty
  const effectiveDirty = isDirty || digestDirty;

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (allowSaveNavigation.current) return false;
    if (!effectiveDirty) return false;
    return currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      if (!effectiveDirty) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [effectiveDirty]);

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

  const unsavedCount = useMemo(
    () => computeUnsavedCount(state) + (digestDirty ? 1 : 0),
    [state, digestDirty],
  );

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <p className="text-gray-700">Failed to load this run.</p>
          <button
            type="button"
            onClick={() => { void query.refetch(); }}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry
          </button>
          <Link to="/admin" className="block text-sm text-blue-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
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

  const isDryRun = query.data.isDryRun === true;
  const isEdit = query.data.reviewed === true;

  const publishedChannels: string[] = [];
  if (query.data.emailSentAt != null) publishedChannels.push("Email");
  if (query.data.linkedinPostedAt != null) publishedChannels.push("LinkedIn");
  if (query.data.twitterPostedAt != null) publishedChannels.push("X");

  const currentSignature = state.current.map((it) => it.id).join("|");

  // The regen gate: needs regen when signature drifted from last sync,
  // UNLESS it's a dry-run (bypass) or the last failure was at this signature (unlock).
  const regenFailed = lastFailedSignature === currentSignature;
  const needsRegen =
    regenSignature !== null &&
    currentSignature !== regenSignature &&
    !isDryRun &&
    !regenFailed;

  // Warning: shown when the ranked list changed but regen was skipped (dry-run or failed)
  const saveWarning =
    (isDryRun || regenFailed) &&
    regenSignature !== null &&
    currentSignature !== regenSignature
      ? "Digest copy may not match the story order — regeneration was skipped."
      : null;

  const canSave =
    state.current.length > 0 &&
    state.pending.length === 0 &&
    state.pendingPromotes.length === 0 &&
    !saving &&
    !needsRegen;
  const saveDisabledReason = needsRegen
    ? "Regenerate the digest meta before saving — the ranked list has changed."
    : null;

  // Regenerate disabled reason for dry-runs
  const regenerateDisabledReason = isDryRun
    ? "Regeneration is unavailable for dry-run archives."
    : null;

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
        digestHeadline: digestMeta.headline,
        digestSummary: digestMeta.summary,
        hook: digestMeta.hook,
        twitterSummary: digestMeta.twitterSummary,
        linkedinPostBody: digestMeta.linkedinPostBody,
      });
      allowSaveNavigation.current = true;
      reset(state.current);
      const newSig = state.current.map((it) => it.id).join("|");
      setRegenSignature(newSig);
      // Update the digest baseline so the dirty flag resets after successful save
      setDigestBaseline(digestMeta);
      void navigate(`/archive/${runId}`);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to save archive";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard(): void {
    discard();
    // Revert digest fields to the last saved/hydrated baseline
    if (digestBaseline !== null) {
      setDigestMeta(digestBaseline);
    }
    // A discarded session's failed-regen marker must not leak into the next
    // edit — without this, re-making the same reorder would show the stale
    // "digest copy may not match" warning before any new regen attempt.
    setLastFailedSignature(null);
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
              {formatHeading(query.data.startedAt, isEdit)}
            </h2>
            {isDryRun ? (
              <span
                className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700"
                data-testid="dry-run-pill"
              >
                Dry run
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground" data-testid="review-page-subtitle">
            {isEdit
              ? "Update posts or copy — the archive and any unsent channels will pick up your changes."
              : "Remove, reorder, or add posts before the archive renders."}
          </p>
        </div>
        {isEdit && publishedChannels.length > 0 ? (
          <div
            className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="published-channels-banner"
          >
            Already published: {publishedChannels.join(", ")} — edits won&apos;t change those. The archive and any unsent channels will update.
          </div>
        ) : null}
        <AddPostPanel
          runId={runId}
          hasUrl={hasUrl}
          onPending={addPending}
          onResolved={resolvePending}
          onFailed={failPending}
        />
        <DigestMetaPanel
          runId={runId}
          items={state.current.map((it) => ({
            id: it.id,
            title: it.title,
            summary: it.recap?.summary ?? "",
            bottomLine: it.recap?.bottomLine ?? "",
          }))}
          values={digestMeta}
          onChange={setDigestMeta}
          onRegenerated={() => {
            setRegenSignature(currentSignature);
            // Clear any failure marker on success
            setLastFailedSignature(null);
          }}
          onRegenerateFailed={() => {
            // Record the signature at which regen failed so Save unlocks at this signature
            setLastFailedSignature(currentSignature);
          }}
          regenerateDisabledReason={regenerateDisabledReason}
        />

        <div className="text-xs text-muted-foreground">
          {state.current.length} posts · Drag to reorder · Top to bottom = most
          important first
        </div>
        <ReviewList
          items={state.current}
          addedIds={state.addedIds}
          onReorder={reorder}
          onDelete={handleRemove}
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
          shortlistedOnly={filters.shortlistedOnly}
          toggleShortlisted={filters.toggleShortlisted}
          selectedSourceTypes={filters.selectedSourceTypes}
          toggleSourceType={filters.toggleSourceType}
          selectedSources={filters.selectedSources}
          toggleSource={filters.toggleSource}
          clearAll={filters.clearAll}
          isFiltered={filters.isFiltered}
          shortlistedItemIds={shortlistedItemIds}
          facets={facets}
          facetsLoading={facetsLoading}
          facetsError={facetsError}
          onRetryFacets={retryFacets}
        />
      </main>
      <SaveBar
        unsavedCount={unsavedCount}
        saving={saving}
        canSave={canSave}
        disabledReason={saveDisabledReason}
        warning={saveWarning}
        onSave={() => {
          void handleSave();
        }}
        onDiscard={handleDiscard}
      />
    </div>
  );
}

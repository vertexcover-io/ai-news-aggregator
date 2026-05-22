import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  Fixture,
  FixtureItem,
  GroundTruth,
  Tier,
} from "@newsletter/shared/types/eval-ranking";
import { useEvalFixture } from "../hooks/useEvalFixture";
import { useGradingProgress } from "../hooks/useGradingProgress";
import { ClusterRow } from "../components/eval/ClusterRow";
import { saveGroundTruth, saveGroundTruthToRepo } from "../api/eval";

const GRADER_KEY = "eval-grader-name";

interface Cluster {
  representative: FixtureItem;
  duplicateCount: number;
}

function engagementScore(item: FixtureItem): number {
  if (item.engagement === null) return 0;
  return item.engagement.points + item.engagement.commentCount;
}

export function buildClusters(fixture: Fixture): Cluster[] {
  const itemsById = new Map<number, FixtureItem>();
  for (const item of fixture.pool) itemsById.set(item.rawItemId, item);

  const clustered = new Set<number>();
  const clusters: Cluster[] = [];

  for (const dc of fixture.dedupClusters) {
    const memberIds = [dc.representativeId, ...dc.duplicateIds];
    const members = memberIds
      .map((id) => itemsById.get(id))
      .filter((m): m is FixtureItem => m !== undefined);
    if (members.length === 0) continue;
    members.sort((a, b) => engagementScore(b) - engagementScore(a));
    const [rep, ...rest] = members;
    for (const m of members) clustered.add(m.rawItemId);
    clusters.push({ representative: rep, duplicateCount: rest.length });
  }

  // Ungrouped items become singleton clusters in pool order.
  for (const item of fixture.pool) {
    if (clustered.has(item.rawItemId)) continue;
    clusters.push({ representative: item, duplicateCount: 0 });
  }

  return clusters;
}

function isTypingInInput(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

function triggerDownload(filename: string, json: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function EvalGradePage(): ReactElement {
  const { fixtureId = "" } = useParams<{ fixtureId: string }>();
  const navigate = useNavigate();
  const [grader, setGrader] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(GRADER_KEY) ?? "";
  });
  const [graderInput, setGraderInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const query = useEvalFixture(fixtureId);
  const progress = useGradingProgress(fixtureId, grader);

  const clusters = useMemo<Cluster[]>(() => {
    if (!query.data) return [];
    return buildClusters(query.data.fixture);
  }, [query.data]);

  const repIds = useMemo(
    () => clusters.map((c) => c.representative.rawItemId),
    [clusters],
  );

  const complete = progress.isComplete(repIds);

  const counts = useMemo(() => {
    let must = 0;
    let nice = 0;
    let drop = 0;
    for (const id of repIds) {
      if (!(id in progress.labels)) continue;
      const tier = progress.labels[id];
      if (tier === "must") must += 1;
      else if (tier === "nice") nice += 1;
      else drop += 1;
    }
    return { must, nice, drop, labeled: must + nice + drop };
  }, [repIds, progress.labels]);

  const labelSelected = useCallback(
    (tier: Tier) => {
      if (selectedIndex >= clusters.length) return;
      const c = clusters[selectedIndex];
      progress.setLabel(c.representative.rawItemId, tier);
      setSelectedIndex((idx) =>
        idx + 1 < clusters.length ? idx + 1 : idx,
      );
    },
    [clusters, selectedIndex, progress],
  );

  const toggleExpansion = useCallback(() => {
    if (selectedIndex >= clusters.length) return;
    const c = clusters[selectedIndex];
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(c.representative.rawItemId)) {
        next.delete(c.representative.rawItemId);
      } else {
        next.add(c.representative.rawItemId);
      }
      return next;
    });
  }, [clusters, selectedIndex]);

  useEffect(() => {
    if (grader.length === 0) return;
    if (clusters.length === 0) return;

    function onKeyDown(e: KeyboardEvent): void {
      if (isTypingInInput(e.target)) return;
      switch (e.key) {
        case "1":
          e.preventDefault();
          labelSelected("must");
          break;
        case "2":
          e.preventDefault();
          labelSelected("nice");
          break;
        case "3":
          e.preventDefault();
          labelSelected("drop");
          break;
        case " ":
        case "Spacebar":
          e.preventDefault();
          toggleExpansion();
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          setSelectedIndex((idx) => (idx > 0 ? idx - 1 : idx));
          break;
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setSelectedIndex((idx) =>
            idx + 1 < clusters.length ? idx + 1 : idx,
          );
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [grader, clusters, labelSelected, toggleExpansion]);

  function submitGraderName(): void {
    const trimmed = graderInput.trim();
    if (trimmed.length === 0) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GRADER_KEY, trimmed);
    }
    setGrader(trimmed);
  }

  function buildGroundTruth(): GroundTruth {
    const labels: { rawItemId: number; tier: Tier }[] = [];
    for (const id of repIds) {
      if (!(id in progress.labels)) continue;
      labels.push({ rawItemId: id, tier: progress.labels[id] });
    }
    return {
      fixtureId,
      gradedBy: [grader],
      gradedAt: new Date().toISOString(),
      labels,
    };
  }

  async function handleExport(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const gt = buildGroundTruth();
      await saveGroundTruth(fixtureId, gt);
      triggerDownload(`${fixtureId}.json`, JSON.stringify(gt, null, 2));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveToRepo(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const gt = buildGroundTruth();
      await saveGroundTruthToRepo(fixtureId, gt);
      void navigate(
        `/admin/eval?fixtureId=${encodeURIComponent(fixtureId)}`,
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (grader.length === 0) {
    return (
      <div
        data-testid="grader-prompt"
        className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      >
        <div className="bg-white rounded-md shadow-sm border border-gray-200 p-6 w-full max-w-md space-y-4">
          <h2 className="text-lg font-semibold">Who's grading?</h2>
          <p className="text-sm text-gray-600">
            Enter your name so progress is saved per grader.
          </p>
          <input
            type="text"
            value={graderInput}
            onChange={(e) => {
              setGraderInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGraderName();
            }}
            placeholder="e.g. aman"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            autoFocus
          />
          <button
            type="button"
            onClick={submitGraderName}
            className="w-full rounded bg-gray-900 text-white text-sm py-2 hover:bg-gray-800"
          >
            Start grading
          </button>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-600">Loading fixture...</p>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 space-y-4">
        <p className="text-gray-700">
          {query.error instanceof Error
            ? query.error.message
            : "Fixture not found."}
        </p>
        <Link to="/admin" className="text-sm text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Grade fixture</h1>
          <p className="text-xs text-gray-500 font-mono">{fixtureId}</p>
        </div>
        <Link
          to="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to dashboard
        </Link>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-6 grid grid-cols-1 md:grid-cols-[1fr_280px] gap-6">
        <section className="space-y-3">
          <p className="text-xs text-gray-500">
            Keys: <kbd>1</kbd> must · <kbd>2</kbd> nice · <kbd>3</kbd> drop ·
            <kbd> space</kbd> expand · <kbd>↑</kbd>/<kbd>↓</kbd> move
          </p>
          {clusters.map((cluster, idx) => (
            <ClusterRow
              key={cluster.representative.rawItemId}
              cluster={cluster}
              currentLabel={progress.labels[cluster.representative.rawItemId]}
              expanded={expandedIds.has(cluster.representative.rawItemId)}
              selected={idx === selectedIndex}
              onLabel={(tier) => {
                setSelectedIndex(idx);
                progress.setLabel(cluster.representative.rawItemId, tier);
                setSelectedIndex((cur) =>
                  cur + 1 < clusters.length ? cur + 1 : cur,
                );
              }}
              onExpand={() => {
                setSelectedIndex(idx);
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(cluster.representative.rawItemId)) {
                    next.delete(cluster.representative.rawItemId);
                  } else {
                    next.add(cluster.representative.rawItemId);
                  }
                  return next;
                });
              }}
            />
          ))}
        </section>
        <aside className="md:sticky md:top-6 self-start space-y-3 bg-white border border-gray-200 rounded-md p-4">
          <h2 className="text-sm font-semibold">Progress</h2>
          <p
            className="text-xs text-gray-600 font-mono"
            data-testid="progress-counter"
          >
            {String(counts.labeled)} / {String(clusters.length)} labeled
          </p>
          <ul className="text-xs space-y-1">
            <li>must: {String(counts.must)}</li>
            <li>nice: {String(counts.nice)}</li>
            <li>drop: {String(counts.drop)}</li>
          </ul>
          <button
            type="button"
            data-testid="export-button"
            disabled={!complete || saving}
            onClick={() => {
              void handleExport();
            }}
            className="w-full rounded bg-gray-900 text-white text-sm py-2 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Export & download"}
          </button>
          {import.meta.env.DEV ? (
            <button
              type="button"
              data-testid="save-to-repo-button"
              disabled={!complete || saving}
              onClick={() => {
                void handleSaveToRepo();
              }}
              className="w-full rounded border border-gray-300 bg-white text-sm py-2 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save to repo (dev)
            </button>
          ) : null}
          {saveError !== null ? (
            <p className="text-xs text-rose-600" data-testid="save-error">
              {saveError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear all labels?")) progress.clearAll();
            }}
            className="w-full text-xs text-gray-500 hover:text-gray-700 mt-2"
          >
            Reset labels
          </button>
        </aside>
      </main>
    </div>
  );
}

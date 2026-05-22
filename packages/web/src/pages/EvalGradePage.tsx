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
import { GradeKeyboardHintBar } from "../components/eval/GradeKeyboardHintBar";
import { GradeProgressRing } from "../components/eval/GradeProgressRing";
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
  const [lastEditAt, setLastEditAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

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

  useEffect(() => {
    if (lastEditAt === null) return;
    const i = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(i);
    };
  }, [lastEditAt]);

  const lastEditSecondsAgo =
    lastEditAt === null ? null : Math.max(0, Math.floor((nowTick - lastEditAt) / 1000));

  const markEdit = useCallback(() => {
    const now = Date.now();
    setLastEditAt(now);
    setNowTick(now);
  }, []);

  const labelSelected = useCallback(
    (tier: Tier) => {
      if (selectedIndex >= clusters.length) return;
      const c = clusters[selectedIndex];
      progress.setLabel(c.representative.rawItemId, tier);
      markEdit();
      setSelectedIndex((idx) =>
        idx + 1 < clusters.length ? idx + 1 : idx,
      );
    },
    [clusters, selectedIndex, progress, markEdit],
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
        className="min-h-screen bg-stone-50 flex items-center justify-center p-6"
      >
        <div className="bg-white rounded-md shadow-sm border border-stone-200 p-6 w-full max-w-md space-y-4">
          <h2 className="text-lg font-semibold">Who's grading?</h2>
          <p className="text-sm text-stone-600">
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
            className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
            autoFocus
          />
          <button
            type="button"
            onClick={submitGraderName}
            className="w-full rounded bg-stone-900 text-white text-sm py-2 hover:bg-stone-800"
          >
            Start grading
          </button>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 p-6">
        <p className="text-stone-600">Loading fixture...</p>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="min-h-screen bg-stone-50 p-6 space-y-4">
        <p className="text-stone-700">
          {query.error instanceof Error
            ? query.error.message
            : "Fixture not found."}
        </p>
        <Link
          to="/admin"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const fixture = query.data.fixture;
  const dedupRate =
    fixture.pool.length === 0
      ? 0
      : Math.round(
          ((fixture.pool.length - clusters.length) /
            fixture.pool.length) *
            100,
        );

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-6 py-4 flex items-center justify-between">
        <Link
          to="/admin/eval"
          className="text-sm text-stone-500 hover:text-stone-900"
        >
          ← Back to eval
        </Link>
        <span className="font-mono text-[11px] text-stone-500">
          Graded by · {grader}
        </span>
      </header>

      <div className="border-b border-stone-200 bg-white px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-start justify-between gap-6">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500 mb-1">
              Grade fixture · {fixture.source}
            </div>
            <h1
              className="font-serif text-3xl text-stone-900"
              style={{ fontFamily: "var(--font-serif, Newsreader), serif" }}
            >
              {fixtureId}
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              <span className="font-mono">{fixtureId}</span> ·{" "}
              {String(clusters.length)} dedup clusters · created from{" "}
              {String(fixture.pool.length)} raw items
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Clear all labels?")) progress.clearAll();
              }}
              className="text-sm rounded border border-stone-300 bg-white px-3 py-2 hover:bg-stone-50"
            >
              Reset labels
            </button>
            <button
              type="button"
              data-testid="export-button"
              disabled={!complete || saving}
              onClick={() => {
                void handleExport();
              }}
              className="text-sm rounded border border-stone-300 bg-white px-3 py-2 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="text-sm rounded text-white px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "#8c3a1e" }}
              >
                Save to repo
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-6">
        <GradeKeyboardHintBar lastEditSecondsAgo={lastEditSecondsAgo} />

        {saveError !== null ? (
          <p
            className="mb-4 text-sm text-rose-600"
            data-testid="save-error"
          >
            {saveError}
          </p>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6 items-start">
          <section className="bg-white border border-stone-200 rounded-lg overflow-hidden">
            {clusters.map((cluster, idx) => (
              <ClusterRow
                key={cluster.representative.rawItemId}
                index={idx}
                cluster={cluster}
                currentLabel={progress.labels[cluster.representative.rawItemId]}
                expanded={expandedIds.has(cluster.representative.rawItemId)}
                selected={idx === selectedIndex}
                onSelect={() => {
                  setSelectedIndex(idx);
                }}
                onLabel={(tier) => {
                  setSelectedIndex(idx);
                  progress.setLabel(cluster.representative.rawItemId, tier);
                  markEdit();
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

          <aside className="md:sticky md:top-4 self-start flex flex-col gap-4">
            <GradeProgressRing
              labeled={counts.labeled}
              total={clusters.length}
              must={counts.must}
              nice={counts.nice}
              drop={counts.drop}
            />

            <div className="bg-stone-50 border border-stone-200 rounded-lg px-5 py-4">
              <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500 mb-2">
                Tip
              </div>
              <p className="text-[12px] text-stone-500 leading-relaxed">
                Aim for ~30% <strong className="text-stone-900">must</strong>,
                ~40% <strong className="text-stone-900">nice</strong>, ~30%{" "}
                <strong className="text-stone-900">drop</strong> in a healthy
                fixture. Heavy skew toward one tier weakens nDCG signal.
              </p>
            </div>

            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <header className="px-5 py-3 border-b border-stone-200 font-mono text-[11px] uppercase tracking-[0.1em] text-stone-900">
                Fixture
              </header>
              <div className="px-5 py-3 flex flex-col gap-2 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-stone-500">Source</span>
                  <span className="font-mono text-stone-900">
                    {fixture.source}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Items pooled</span>
                  <span className="font-mono text-stone-900">
                    {String(fixture.pool.length)} raw →{" "}
                    {String(clusters.length)} clusters
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Dedup rate</span>
                  <span className="font-mono text-stone-900">
                    {String(dedupRate)}%
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

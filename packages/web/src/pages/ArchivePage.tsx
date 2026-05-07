import { useEffect, type ReactElement } from "react";
import { useParams, Link } from "react-router-dom";
import { useArchive } from "../hooks/useArchive";
import { ArchivePageHeader, pickHeadline } from "../components/ArchivePageHeader";
import { ArchiveStoryCard } from "../components/ArchiveStoryCard";
import { ArchiveShareRow } from "../components/ArchiveShareRow";
import { setMeta } from "../lib/meta";
import { SubscribeWidget } from "../components/SubscribeWidget";

function formatIssueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ArchivePage(): ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const { isLoading, data, isError } = useArchive(runId ?? "");

  const items = data?.status === "completed" ? (data.rankedItems ?? []) : [];
  const topStoryTitle = items[0]?.title ?? null;
  const digestHeadline = data?.digestHeadline ?? null;
  const digestSummary = data?.digestSummary ?? null;

  useEffect(() => {
    if (data?.status === "completed") {
      const title = `AI news - ${formatIssueDate(data.startedAt)}`;
      document.title = title;
      setMeta("og:title", title);
      setMeta(
        "description",
        digestSummary ?? pickHeadline(null, topStoryTitle, digestHeadline),
      );
    }
  }, [data, topStoryTitle, digestHeadline, digestSummary]);

  if (isLoading) {
    return (
      <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 md:px-20">
          <div role="status" aria-busy="true" aria-label="Loading issue" className="py-12 space-y-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)_120px] gap-4 md:gap-10 animate-pulse">
                <div className="h-16 rounded bg-[#1A1A1A0A]" />
                <div className="h-24 rounded bg-[#1A1A1A0A]" />
                <div className="h-8 rounded bg-[#1A1A1A0A]" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 md:px-20">
          <div className="py-16">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8C3A1E]">ERROR</p>
            <h2 className="mt-3 font-serif text-3xl md:text-5xl font-medium text-neutral-900">Couldn't load this issue</h2>
            <Link
              to="/"
              className="mt-6 inline-flex items-center min-h-[44px] px-2 font-mono text-xs uppercase tracking-widest text-neutral-600 hover:text-neutral-900"
            >
              ← All issues
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (data === null || data === undefined) {
    return (
      <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 md:px-20">
          <div className="py-16">
            <h2 className="font-serif text-3xl md:text-5xl font-medium text-neutral-900">This issue isn't here</h2>
            <p className="mt-3 font-mono text-xs uppercase tracking-widest text-neutral-600">
              It may have been removed or never existed.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex items-center min-h-[44px] px-2 font-mono text-xs uppercase tracking-widest text-neutral-600 hover:text-neutral-900"
            >
              ← All issues
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (data.status === "cancelled") {
    return (
      <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 md:px-20">
          <div className="py-16">
            <h2 className="font-serif text-3xl md:text-5xl font-medium text-neutral-900">This issue was cancelled.</h2>
            <Link
              to="/"
              className="mt-6 inline-flex items-center min-h-[44px] px-2 font-mono text-xs uppercase tracking-widest text-neutral-600 hover:text-neutral-900"
            >
              ← All issues
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (data.status !== "completed") {
    return (
      <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 md:px-20">
          <div className="py-16">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8C3A1E]">IN PROGRESS</p>
            <h2 className="mt-3 font-serif text-3xl md:text-5xl font-medium text-neutral-900">
              Today's issue is still being curated.
            </h2>
            <Link
              to="/"
              className="mt-6 inline-flex items-center min-h-[44px] px-2 font-mono text-xs uppercase tracking-widest text-neutral-600 hover:text-neutral-900"
            >
              ← All issues
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 md:px-20">
        <ArchivePageHeader
          startedAt={data.startedAt}
          storyCount={items.length}
          leadSummary={null}
          topStoryTitle={topStoryTitle}
          digestHeadline={digestHeadline}
          digestSummary={digestSummary}
        />
        <ArchiveShareRow
          archiveUrl={typeof window === "undefined" ? "" : window.location.href}
          shareText={`AI news - ${formatIssueDate(data.startedAt)}`}
        />
        {items.length === 0 ? (
          <p className="py-8 font-serif text-xl text-neutral-600">No stories in this issue.</p>
        ) : (
          <div>
            {items.map((item, idx) => (
              <ArchiveStoryCard key={item.id} item={item} rank={idx + 1} />
            ))}
          </div>
        )}
        <div className="mt-12 border-t border-neutral-200 pt-8 max-w-[480px]">
          <SubscribeWidget />
        </div>
        <div className="py-16">
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] px-2 font-mono text-xs uppercase tracking-widest text-neutral-600 hover:text-neutral-900"
          >
            ← All issues
          </Link>
        </div>
      </div>
    </main>
  );
}

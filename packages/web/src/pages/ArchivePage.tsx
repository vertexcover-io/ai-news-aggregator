import { useEffect, type ReactElement } from "react";
import { useParams, Link } from "react-router-dom";
import { useArchive } from "../hooks/useArchive";
import { ArchivePageHeader, pickHeadline } from "../components/ArchivePageHeader";
import { ArchiveStoryCard } from "../components/ArchiveStoryCard";
import { ArchiveShareRow } from "../components/ArchiveShareRow";
import { setMeta } from "../lib/meta";
import { SubscribeInline } from "../components/archive-listing/SubscribeInline";
import { ScrollToTop } from "../components/ScrollToTop";
import { readingTimeMinutes } from "../lib/readingTime";
import { captureBrowserEvent } from "../lib/analytics";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateFromIsoDate(dateISO: string): Date | null {
  const parsed = ISO_DATE_RE.exec(dateISO);
  if (parsed === null) return null;
  const [, year, month, day] = parsed;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatIssueDate(value: string): string {
  const dateOnly = dateFromIsoDate(value);
  const d = dateOnly ?? new Date(value);
  return d.toLocaleDateString("en-US", {
    timeZone: dateOnly === null ? undefined : "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function resolveIssueDate(
  issueDate: string | null | undefined,
  startedAt: string | null | undefined,
): string {
  const value = issueDate ?? startedAt ?? "";
  return value.length > 0 ? formatIssueDate(value) : "";
}

export function resolveShareTitle(
  topStoryTitle: string | null,
  digestHeadline: string | null,
  fallbackTitle: string,
): string {
  return topStoryTitle ?? digestHeadline ?? fallbackTitle;
}

function LoadingState(): ReactElement {
  return (
    <PageShell>
      <div role="status" aria-busy="true" aria-label="Loading issue" className="space-y-6 py-12">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="grid grid-cols-1 md:grid-cols-[120px_1fr_120px] gap-4 md:gap-10 animate-pulse"
          >
            <div className="h-16 rounded bg-[#f1ede2]" />
            <div className="h-24 rounded bg-[#f1ede2]" />
            <div className="h-8 rounded bg-[#f1ede2]" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}

function ErrorState(): ReactElement {
  return (
    <PageShell>
      <div className="py-16">
        <BackToArchive />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8c3a1e] text-center">
          ERROR
        </p>
        <h2 className="mt-3 font-serif text-3xl md:text-5xl font-medium text-[#14110d] text-center">
          Couldn't load this issue
        </h2>
      </div>
    </PageShell>
  );
}

function NotFoundState(): ReactElement {
  return (
    <PageShell>
      <div className="py-16">
        <BackToArchive />
        <h2 className="font-serif text-3xl md:text-5xl font-medium text-[#14110d] text-center">
          This issue isn't here
        </h2>
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-[#6b6557] text-center">
          It may have been removed or never existed.
        </p>
      </div>
    </PageShell>
  );
}

function CancelledState(): ReactElement {
  return (
    <PageShell>
      <div className="py-16">
        <BackToArchive />
        <h2 className="font-serif text-3xl md:text-5xl font-medium text-[#14110d] text-center">
          This issue was cancelled.
        </h2>
      </div>
    </PageShell>
  );
}

function InProgressState(): ReactElement {
  return (
    <PageShell>
      <div className="py-16">
        <BackToArchive />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8c3a1e] text-center">
          IN PROGRESS
        </p>
        <h2 className="mt-3 font-serif text-3xl md:text-5xl font-medium text-[#14110d] text-center">
          Today's issue is still being curated.
        </h2>
      </div>
    </PageShell>
  );
}

function BackToArchive(): ReactElement {
  return (
    <div className="text-center mb-7">
      <Link
        to="/"
        aria-label="Back to archive"
        className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#6b6557] no-underline hover:text-[#14110d] [&:hover>svg]:-translate-x-[3px] min-h-[44px] px-2"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-3 w-3 transition-transform duration-150"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        <span>Back to archive</span>
      </Link>
    </div>
  );
}

function PageShell({ children }: { children: ReactElement }): ReactElement {
  return (
    <main className="min-h-[calc(100vh-8rem)] bg-[#fbfaf7]">
      <div className="mx-auto max-w-[720px] px-5 sm:px-7 pt-8 sm:pt-12 md:pt-14 pb-16 md:pb-24">
        {children}
      </div>
      <ScrollToTop />
    </main>
  );
}

export function ArchivePage(): ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const { isLoading, data, isError } = useArchive(runId ?? "");

  const items = data?.status === "completed" ? (data.rankedItems ?? []) : [];
  const hasTopStory = items.length > 0;
  const topStoryTitle = hasTopStory ? items[0].title : null;
  const digestHeadline = data?.digestHeadline ?? null;
  const digestSummary = data?.digestSummary ?? null;
  const issueDate = resolveIssueDate(data?.issueDate, data?.startedAt);
  const fallbackTitle = `AI news - ${issueDate}`;
  const shareTitle = resolveShareTitle(topStoryTitle, digestHeadline, fallbackTitle);
  const readingMin = readingTimeMinutes(items);

  useEffect(() => {
    if (data?.status === "completed") {
      document.title = shareTitle;
      setMeta("og:title", shareTitle);
      setMeta(
        "description",
        digestSummary ?? pickHeadline(topStoryTitle, digestHeadline),
      );
    }
  }, [data, topStoryTitle, digestHeadline, digestSummary, shareTitle]);

  useEffect(() => {
    if (data?.status !== "completed") return;
    captureBrowserEvent("archive_opened", {
      run_id: data.id,
      story_count: items.length,
    });
  }, [data?.id, data?.status, items.length]);

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;
  if (data === null || data === undefined) return <NotFoundState />;
  if (data.status === "cancelled") return <CancelledState />;
  if (data.status !== "completed") return <InProgressState />;

  // Place the subscribe interlude after the midpoint when there are at least 4 stories
  const interludeAfter =
    items.length >= 4 ? Math.floor(items.length / 2) : -1;

  return (
    <PageShell>
      <>
        <BackToArchive />
        <ArchivePageHeader
          issueDate={data.issueDate ?? data.startedAt}
          storyCount={items.length}
          topStoryTitle={topStoryTitle}
          digestHeadline={digestHeadline}
          digestSummary={digestSummary}
          readingTimeMin={readingMin}
        />
        <ArchiveShareRow
          archiveUrl={typeof window === "undefined" ? "" : window.location.href}
          shareText={shareTitle}
          runId={data.id}
        />
        {items.length === 0 ? (
          <p className="py-8 text-center font-serif text-xl italic text-[#6b6557]">
            No stories in this issue.
          </p>
        ) : (
          <div>
            {items.map((item, idx) => (
              <div key={item.id}>
                <ArchiveStoryCard item={item} rank={idx + 1} />
                {interludeAfter !== -1 && idx === interludeAfter ? (
                  <div className="my-6">
                    <SubscribeInline variant="interlude" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </>
    </PageShell>
  );
}

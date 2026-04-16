import type { ReactElement } from "react";
import { useParams, Link } from "react-router-dom";
import { useArchive } from "../hooks/useArchive";
import { ArchivePageHeader } from "../components/ArchivePageHeader";
import { ArchiveStoryCard } from "../components/ArchiveStoryCard";

export function ArchivePage(): ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const { isLoading, data, isError } = useArchive(runId ?? "");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <p role="alert" className="text-red-600">
            Something went wrong. Please try again.
          </p>
          <Link to="/" className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (data === null || data === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-600">Run not found — it may have expired.</p>
      </div>
    );
  }

  if (data.status !== "completed") {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <p className="text-gray-600">
            Run is still in progress — check back soon.
          </p>
          <Link to="/" className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const items = data.rankedItems ?? [];

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <ArchivePageHeader
          startedAt={data.startedAt}
          storyCount={items.length}
        />
        <div className="space-y-8">
          {items.map((item, index) => (
            <ArchiveStoryCard key={item.id} item={item} rank={index + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

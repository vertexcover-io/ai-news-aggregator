import type { ReactElement } from "react";
import { Link } from "react-router-dom";

interface ArchivePageHeaderProps {
  startedAt: string;
  storyCount: number;
  profileName: string | null;
}

function formatEditionDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

export function ArchivePageHeader({
  startedAt,
  storyCount,
  profileName,
}: ArchivePageHeaderProps): ReactElement {
  return (
    <header className="pb-8 mb-10 border-b border-gray-200">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            AI Newsletter
          </h1>
          <p className="text-base text-gray-400 mt-1">Your AI News Digest</p>
        </div>
        <Link
          to="/run"
          className="text-sm text-gray-400 hover:text-gray-600 hover:underline mt-2"
        >
          ← Back to Run
        </Link>
      </div>
      <p className="text-sm text-gray-500 mt-4">
        {formatEditionDate(startedAt)} · {storyCount}{" "}
        {storyCount === 1 ? "story" : "stories"}
        {profileName ? ` · ${profileName}` : ""}
      </p>
    </header>
  );
}

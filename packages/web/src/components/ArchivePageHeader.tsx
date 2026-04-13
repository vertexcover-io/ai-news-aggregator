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
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function ArchivePageHeader({
  startedAt,
  storyCount,
  profileName,
}: ArchivePageHeaderProps): ReactElement {
  return (
    <header className="border-b border-gray-200 pb-4 mb-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Newsletter</h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatEditionDate(startedAt)} · {storyCount}{" "}
            {storyCount === 1 ? "story" : "stories"} · profile:{" "}
            {profileName ?? "default"}
          </p>
        </div>
        <Link to="/run" className="text-sm text-blue-600 hover:underline mt-1">
          ← Back to Run
        </Link>
      </div>
    </header>
  );
}

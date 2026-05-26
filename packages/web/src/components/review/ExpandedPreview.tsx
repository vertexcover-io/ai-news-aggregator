import type { ReactElement } from "react";
import type { ItemPreview } from "@newsletter/shared/types";
import { SafeMarkdown } from "./SafeMarkdown";

interface ExpandedPreviewProps {
  preview: ItemPreview;
  recapSummary: string | null;
}

export function ExpandedPreview({
  preview,
  recapSummary,
}: ExpandedPreviewProps): ReactElement {
  if (preview.kind === "tweet") {
    return (
      <div className="border border-dashed border-gray-300 bg-stone-50 rounded-md p-3 space-y-2 text-sm">
        <div className="font-semibold text-sky-700">{preview.handle}</div>
        <p className="text-gray-800">{preview.text}</p>
        {preview.quoted && (
          <div className="border border-gray-200 rounded p-2 bg-white text-xs space-y-1">
            <div className="font-semibold text-sky-600">{preview.quoted.handle}</div>
            <p className="text-gray-700">{preview.quoted.text}</p>
          </div>
        )}
        {preview.photoUrls.length > 0 && (
          <div className="flex gap-1">
            {preview.photoUrls.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                referrerPolicy="no-referrer"
                className="h-20 w-20 rounded object-cover"
              />
            ))}
          </div>
        )}
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-sky-600 hover:underline text-xs"
        >
          View on X ↗
        </a>
      </div>
    );
  }

  if (preview.kind === "link") {
    return (
      <div className="border border-dashed border-gray-300 bg-stone-50 rounded-md p-3 space-y-2 text-sm">
        {preview.imageUrl && (
          <img
            src={preview.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-32 object-cover rounded"
          />
        )}
        {preview.title && (
          <div className="font-semibold text-gray-800">{preview.title}</div>
        )}
        {preview.byline && (
          <div className="text-xs text-gray-500">{preview.byline}</div>
        )}
        {preview.domain && (
          <div className="text-xs text-gray-400">{preview.domain}</div>
        )}
        {preview.description && (
          <p className="text-gray-600 text-xs">{preview.description}</p>
        )}
        {preview.markdownExcerpt && (
          <div className="text-xs text-gray-700 border-t pt-2 prose prose-xs max-w-none">
            <SafeMarkdown markdown={preview.markdownExcerpt} />
          </div>
        )}
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-blue-600 hover:underline text-xs"
        >
          Open source ↗
        </a>
      </div>
    );
  }

  // kind === "none"
  return (
    <div className="border border-dashed border-gray-300 bg-stone-50 rounded-md p-3 space-y-1 text-sm">
      {recapSummary && (
        <p className="text-gray-700 text-xs">{recapSummary}</p>
      )}
      <p className="text-gray-400 text-xs italic">Full preview unavailable</p>
    </div>
  );
}

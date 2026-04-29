import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";
import type { RankedItem } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPost } from "../../api/archives";

interface AddPostPanelProps {
  runId: string;
  hasUrl: (url: string) => boolean;
  onPending: (p: { tempId: string; url: string }) => void;
  onResolved: (tempId: string, item: RankedItem) => void;
  onFailed: (tempId: string) => void;
}

const DUPLICATE_ERROR = "This post is already in the list.";

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function AddPostPanel({
  runId,
  hasUrl,
  onPending,
  onResolved,
  onFailed,
}: AddPostPanelProps): ReactElement {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = url.trim();
  const canSubmit = trimmed !== "" && isValidUrl(trimmed) && !submitting;

  async function submit(): Promise<void> {
    setError(null);
    if (trimmed === "" || !isValidUrl(trimmed)) return;
    if (hasUrl(trimmed)) {
      setError(DUPLICATE_ERROR);
      return;
    }
    const tempId = `pending-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
    onPending({ tempId, url: trimmed });
    setSubmitting(true);
    try {
      const item = await addPost(runId, { url: trimmed });
      onResolved(tempId, item);
      setUrl("");
    } catch (e) {
      onFailed(tempId);
      setError(e instanceof Error ? e.message : "Failed to add post");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): void {
    e.preventDefault();
    void submit();
  }

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="size-4" />
        Add a post
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          type="url"
          aria-label="Article URL"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
          disabled={submitting}
          className="flex-1 min-h-[44px]"
        />
        <Button
          type="submit"
          disabled={!canSubmit}
          className="bg-black text-white hover:bg-black/90"
        >
          Add post
        </Button>
      </form>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

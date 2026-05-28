import { type ReactElement, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import {
  DEFAULT_LINKEDIN_HOOK,
  buildLinkedinPostBody,
} from "@newsletter/shared/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  regenerateDigestMeta,
  type RegenerateDigestMetaItem,
} from "../../api/archives";

const HOOK_MAX_CHARS = 140;
const TWITTER_SUMMARY_MAX_CHARS = 180;

export type RegenerateItem = RegenerateDigestMetaItem;

export interface DigestMetaValues {
  headline: string;
  summary: string;
  hook: string;
  twitterSummary: string;
}

interface DigestMetaPanelProps {
  runId: string;
  items: RegenerateItem[];
  values: DigestMetaValues;
  onChange: (values: DigestMetaValues) => void;
  onRegenerated?: () => void;
}

function CharCounter({
  count,
  max,
  testId,
}: {
  count: number;
  max: number;
  testId: string;
}): ReactElement {
  const over = count > max;
  return (
    <span
      data-testid={testId}
      data-over-limit={over ? "true" : "false"}
      className={`text-xs ${over ? "font-medium text-red-600" : "text-muted-foreground"}`}
    >
      {count}/{max}
    </span>
  );
}

export function DigestMetaPanel({
  runId,
  items,
  values,
  onChange,
  onRegenerated,
}: DigestMetaPanelProps): ReactElement {
  const mutation = useMutation({
    mutationFn: () => regenerateDigestMeta(runId, items),
    onSuccess: (meta) => {
      // LinkedIn header is admin-only — preserve the existing hook on regen
      // instead of overwriting with the LLM-generated value (which is now
      // discarded by the pipeline anyway).
      onChange({
        headline: meta.headline,
        summary: meta.summary,
        hook: values.hook,
        twitterSummary: meta.twitterSummary,
      });
      onRegenerated?.();
    },
  });

  const linkedinPreview = useMemo(
    () =>
      buildLinkedinPostBody(
        values.hook,
        items.map((it) => ({ summary: it.summary })),
      ),
    [values.hook, items],
  );

  const regenerating = mutation.isPending;
  const canRegenerate = items.length > 0 && !regenerating;

  function update<K extends keyof DigestMetaValues>(
    key: K,
    value: DigestMetaValues[K],
  ): void {
    onChange({ ...values, [key]: value });
  }

  const errorMessage =
    mutation.error instanceof Error
      ? mutation.error.message
      : mutation.isError
        ? "Failed to regenerate digest meta"
        : null;

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4" />
          Digest meta
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!canRegenerate}
          onClick={() => {
            mutation.mutate();
          }}
        >
          {regenerating ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Regenerating…
            </>
          ) : (
            "Regenerate"
          )}
        </Button>
      </div>

      {errorMessage !== null && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="digest-headline">Headline</Label>
        <Input
          id="digest-headline"
          value={values.headline}
          onChange={(e) => {
            update("headline", e.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="digest-summary">Summary</Label>
        <textarea
          id="digest-summary"
          rows={3}
          value={values.summary}
          onChange={(e) => {
            update("summary", e.target.value);
          }}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="digest-hook">LinkedIn Header</Label>
          <CharCounter
            count={values.hook.length}
            max={HOOK_MAX_CHARS}
            testId="hook-counter"
          />
        </div>
        <textarea
          id="digest-hook"
          rows={2}
          value={values.hook}
          onChange={(e) => {
            update("hook", e.target.value);
          }}
          placeholder={DEFAULT_LINKEDIN_HOOK}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to use the default: <span className="font-medium">{DEFAULT_LINKEDIN_HOOK}</span>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>LinkedIn post preview</Label>
        <pre
          data-testid="linkedin-post-preview"
          className="whitespace-pre-wrap rounded-md border border-input bg-muted/40 px-3 py-2 text-xs font-sans text-foreground"
        >
          {linkedinPreview}
        </pre>
        <p className="text-xs text-muted-foreground">
          Top {Math.min(items.length, 5)} of {items.length} ranked stories.
          Archive link is posted as a follow-up comment.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="digest-twitter-summary">Twitter Summary</Label>
          <CharCounter
            count={values.twitterSummary.length}
            max={TWITTER_SUMMARY_MAX_CHARS}
            testId="twitter-summary-counter"
          />
        </div>
        <textarea
          id="digest-twitter-summary"
          rows={3}
          value={values.twitterSummary}
          onChange={(e) => {
            update("twitterSummary", e.target.value);
          }}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
      </div>
    </div>
  );
}

import { useState, type ReactElement } from "react";
import { useFormContext, useFieldArray, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import type { SourceType } from "@newsletter/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { discoverSources, type SourceCandidate } from "@/api/onboarding";
import { StepShell } from "./StepShell";
import type { WizardData, SelectedSource } from "./types";

interface SourcesStepProps {
  onBack: () => void;
  onContinue: () => void;
}

const GROUP_LABEL: Record<string, string> = {
  reddit: "Reddit",
  rss: "RSS / Blogs",
  blog: "RSS / Blogs",
  newsletter: "RSS / Blogs",
  twitter: "X / Handles",
  hn: "Hacker News",
  github: "GitHub",
  web_search: "Web search",
};

function inferType(raw: string): SourceType {
  const v = raw.trim();
  if (v.startsWith("@")) return "twitter";
  if (v.startsWith("r/") || v.includes('reddit.com')) return "reddit";
  if (/^https?:\/\//.test(v)) return "rss";
  return "rss";
}

export function SourcesStep({ onBack, onContinue }: SourcesStepProps): ReactElement {
  const { control } = useFormContext<WizardData>();
  const { fields, append, remove } = useFieldArray({ control, name: "sources" });
  const blurb = useWatch({ control, name: "blurb" });
  const [manual, setManual] = useState("");

  const discovery = useMutation({
    mutationFn: () => discoverSources(blurb || ""),
  });

  const selected = fields as unknown as (SelectedSource & { id: string })[];
  const selectedKeys = new Set(
    selected.map((s) => `${s.type}:${s.name.toLowerCase()}`),
  );

  function addSource(src: SelectedSource): void {
    const key = `${src.type}:${src.name.toLowerCase()}`;
    if (selectedKeys.has(key)) return;
    append(src);
  }

  function addManual(): void {
    const name = manual.trim();
    if (!name) return;
    addSource({ type: inferType(name), name, config: {} });
    setManual("");
  }

  const candidates = discovery.data ?? [];
  const groups = candidates.reduce<Record<string, SourceCandidate[]>>(
    (acc, c) => {
      const label = GROUP_LABEL[c.type] ?? "Other";
      (acc[label] ??= []).push(c);
      return acc;
    },
    {},
  );

  return (
    <StepShell
      stepNumber={7}
      title="Choose your sources"
      blurb="Suggestions from your description (LLM + Tavily). Click to add — or add your own. You need at least one."
      onBack={onBack}
      onContinue={onContinue}
      continueDisabled={selected.length === 0}
    >
      <div className="mb-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={discovery.isPending}
          onClick={() => { discovery.mutate(); }}
        >
          {discovery.isPending ? "Discovering…" : "✦ Suggest sources"}
        </Button>
      </div>

      {Object.entries(groups).map(([label, items]) => (
        <div key={label} className="mb-4" data-testid="suggest-group">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] uppercase text-[#6b6557]">
            {label}
          </div>
          <div className="flex flex-wrap gap-2">
            {items.map((c) => {
              const key = `${c.type}:${c.name.toLowerCase()}`;
              const added = selectedKeys.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={added}
                  onClick={() => { addSource(c); }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#c9c0ad] bg-[#f7f3ea] px-3 py-1.5 text-[13px] text-[#39342b] transition-colors hover:border-[#8c3a1e] disabled:opacity-40"
                >
                  <span className="text-[#8c3a1e]">+</span> {c.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <hr className="my-4 border-0 border-t border-[#e7e2d6]" />

      <Label>Selected · {selected.length} sources</Label>
      <div
        data-testid="selected-sources"
        className="mt-2 mb-3.5 flex flex-wrap gap-2"
      >
        {selected.length === 0 ? (
          <span className="text-sm text-[#9b9384]">No sources yet.</span>
        ) : (
          selected.map((s, i) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-2 rounded-full border border-[#c9c0ad] bg-white px-3 py-1.5 text-[13px] text-[#39342b]"
            >
              {s.name}
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() => { remove(i); }}
                className="text-[#9b9384] hover:text-[#b3261e]"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="ob-manual">Add manually</Label>
        <div className="flex gap-2">
          <Input
            id="ob-manual"
            value={manual}
            onChange={(e) => { setManual(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            placeholder="Paste an RSS feed, subreddit, or @handle"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={addManual}>
            Add
          </Button>
        </div>
      </div>
    </StepShell>
  );
}

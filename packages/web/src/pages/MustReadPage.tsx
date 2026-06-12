import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMustRead } from "../api/must-read";
import { setMeta } from "../lib/meta";
import {
  brandDisplayName,
  useTenantBranding,
} from "../hooks/useTenantBranding";
import { MustReadEntryView } from "../components/must-read/MustReadEntryView";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";

const TAGLINE =
  "The seminal reading on agentic coding, harness engineering, and the software factory. Annotated and kept current.";

const lastRevisedFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function lastRevised(entries: { addedAt: string }[]): string {
  if (entries.length === 0) return lastRevisedFormatter.format(new Date());
  const latest = entries.reduce((acc, e) => {
    const t = new Date(e.addedAt).getTime();
    return Number.isFinite(t) && t > acc ? t : acc;
  }, 0);
  if (latest === 0) return lastRevisedFormatter.format(new Date());
  return lastRevisedFormatter.format(new Date(latest));
}

export function MustReadPage(): ReactElement {
  const branding = useTenantBranding();
  useEffect(() => {
    document.title = `Must Read — ${brandDisplayName(branding)}`;
    setMeta("description", TAGLINE);
  }, [branding]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["must-read", "list"],
    queryFn: listMustRead,
  });

  const entries = data ?? [];
  const sorted = [...entries].sort(
    (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
  );

  return (
    <main className="max-w-[760px] mx-auto">
      <section className="pt-22 pb-14">
        <h1 className="font-serif font-medium text-[clamp(64px,10vw,96px)] leading-[0.96] tracking-[-0.025em] text-[#14110d] m-0">
          Must Read
        </h1>
        <p className="font-serif italic font-normal text-[22px] leading-[1.45] text-[#2a261f] max-w-[620px] mt-7 mb-0">
          {TAGLINE}
        </p>
        <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-[#6b6557] mt-9">
          Last revised: {lastRevised(sorted)}
          <span className="mx-2.5 opacity-60">·</span>
          {sorted.length} {sorted.length === 1 ? "entry" : "entries"}
        </div>
      </section>

      <hr className="border-0 border-t border-[#e7e2d6] m-0" />

      <InlineSubscribeCard />

      <section className="pt-20" data-section="entries">
        {isLoading ? (
          <div className="py-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
            Loading…
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8c3a1e]">
              Error
            </p>
            <p className="font-serif text-xl text-[#2a261f] mt-2">
              Couldn’t load the canon
            </p>
          </div>
        ) : (
          <div className="flex flex-col" data-section="entry-list">
            {sorted.map((entry) => (
              <MustReadEntryView key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-24">
        <InlineSubscribeCard />
      </div>
    </main>
  );
}

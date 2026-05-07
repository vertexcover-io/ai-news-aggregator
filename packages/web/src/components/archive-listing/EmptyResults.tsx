import type { ReactElement } from "react";

export interface EmptyResultsProps {
  q: string;
}

export function EmptyResults({ q }: EmptyResultsProps): ReactElement {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        NO MATCHES
      </p>
      <h2 className="mt-3 font-serif text-2xl text-neutral-900">
        {`Nothing in the archive matched "${q}".`}
      </h2>
      <p className="mt-3 font-sans text-[15px] text-neutral-600">
        Try a shorter query, a source name, or an author handle.
      </p>
    </div>
  );
}

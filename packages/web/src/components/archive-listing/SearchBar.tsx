import { useEffect, useState, type ChangeEvent, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";

const DEBOUNCE_MS = 250;

export function SearchBar(): ReactElement {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [value, setValue] = useState(urlQ);

  useEffect(() => {
    if (value === urlQ) return;
    if (value.length === 1) return; // EDGE-002: skip 1-char queries
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (value.length === 0) {
        next.delete("q");
      } else {
        next.set("q", value);
      }
      setParams(next, { replace: true });
    }, DEBOUNCE_MS);
    return (): void => {
      clearTimeout(handle);
    };
  }, [value, urlQ, params, setParams]);

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
  };

  const onClear = (): void => {
    setValue("");
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[220px]">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-base text-neutral-500"
        >
          ⌕
        </span>
        <input
          type="search"
          value={value}
          onChange={onChange}
          placeholder="Search the archive…"
          aria-label="Search the archive"
          className="w-full min-h-[44px] pl-9 pr-20 py-2 font-serif italic text-base text-neutral-900 placeholder:font-serif placeholder:italic placeholder:text-neutral-400 bg-transparent border-b border-neutral-300 focus:border-neutral-900 focus:outline-none"
        />
        {value.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[44px] px-2 font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

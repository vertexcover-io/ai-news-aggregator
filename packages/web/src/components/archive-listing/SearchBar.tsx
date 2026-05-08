import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { useSearchParams } from "react-router-dom";

const DEBOUNCE_MS = 250;

export function SearchBar(): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [value, setValue] = useState(urlQ);

  useEffect(() => {
    if (value === urlQ) return;
    if (value.length === 1) return; // skip 1-char queries
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (value.length === 0) next.delete("q");
      else next.set("q", value);
      setParams(next, { replace: true });
    }, DEBOUNCE_MS);
    return (): void => {
      clearTimeout(handle);
    };
  }, [value, urlQ, params, setParams]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return (): void => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const onInput = (e: ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
  };

  return (
    <div
      role="search"
      className="flex h-11 items-center rounded-full border border-[#e7e2d6] bg-[#ffffff] py-0 pl-[18px] pr-3 transition-[border-color,box-shadow] duration-150 hover:border-[#d4ceba] focus-within:border-[#14110d] focus-within:shadow-[0_0_0_4px_rgba(20,17,13,0.06)]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mr-3 h-[15px] w-[15px] flex-none text-[#6b6557]"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={onInput}
        aria-label="Search the archive"
        placeholder={"Search the archive — try “speculative decoding” or “agent sandbox”"}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14.5px] text-[#14110d] outline-none placeholder:text-[#8a8472]"
      />
      <span className="hidden flex-none rounded border border-[#e7e2d6] bg-[#f1ede2] px-[7px] py-[2px] font-mono text-[10.5px] text-[#6b6557] sm:inline-block">
        ⌘K
      </span>
    </div>
  );
}

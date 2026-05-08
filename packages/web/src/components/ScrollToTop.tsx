import { useEffect, useState, type ReactElement } from "react";

export function ScrollToTop(): ReactElement {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = (): void => {
      setVisible(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return (): void => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const onClick = (): void => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      data-visible={visible ? "true" : "false"}
      onClick={onClick}
      className={[
        "fixed right-4 bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-[#14110d] text-[#fbfaf7]",
        "shadow-[0_4px_16px_rgba(20,17,13,0.15)] transition-[opacity,transform,background-color] duration-200",
        "hover:bg-black sm:right-6 sm:bottom-6 sm:h-11 sm:w-11",
        visible
          ? "translate-y-0 opacity-100 pointer-events-auto"
          : "translate-y-2 opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}

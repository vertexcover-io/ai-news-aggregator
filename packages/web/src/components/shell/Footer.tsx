import {
  useState,
  type ChangeEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { BrandMark } from "./BrandMark";
import { postSubscribe } from "../../api/subscribe";
import { captureBrowserEvent } from "../../lib/analytics";
import { markSubscribed } from "../../lib/subscriptionStorage";

type State = "idle" | "loading" | "success" | "error";

function FooterSubscribeField(): ReactElement {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!email || state === "loading") return;
    setState("loading");
    captureBrowserEvent("subscribe_form_submitted", { source: "footer" });
    void postSubscribe(email).then((result) => {
      if ("error" in result) {
        captureBrowserEvent("subscribe_form_failed", {
          source: "footer",
          error_code: result.error,
        });
        setState("error");
      } else {
        captureBrowserEvent("subscribe_form_succeeded", { source: "footer" });
        setState("success");
        markSubscribed();
      }
    });
  };

  const onEmail = (e: ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value);
  };

  if (state === "success") {
    return (
      <p className="font-serif italic text-[14px] text-[#2a261f]">
        Thanks — check your inbox.
      </p>
    );
  }

  return (
    <form
      data-purpose="subscribe"
      onSubmit={onSubmit}
      aria-label="Subscribe in footer"
      className="flex items-center border-b border-[#14110d]"
    >
      <input
        type="email"
        required
        aria-label="Email"
        placeholder="Your email, every morning"
        value={email}
        onChange={onEmail}
        disabled={state === "loading"}
        className="flex-1 bg-transparent border-0 px-[4px] py-2 font-serif italic text-[14px] text-[#14110d] outline-none placeholder:text-[#6b6557]"
      />
      <button
        type="submit"
        disabled={state === "loading" || !email}
        className="bg-transparent border-0 px-[2px] py-2 font-mono uppercase tracking-[0.22em] text-[10.5px] text-[#8c3a1e] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {state === "loading" ? "…" : "Subscribe →"}
      </button>
    </form>
  );
}

export function Footer(): ReactElement {
  const { pathname } = useLocation();
  const showColophon = pathname !== "/built";
  return (
    <footer className="mt-18">
      {showColophon ? (
        <>
          <hr className="border-0 border-t border-[#e7e2d6] m-0" />
          <div className="py-12 text-center">
            <p className="font-serif italic font-normal text-[22px] leading-[1.5] text-[#14110d] mx-auto max-w-[58ch] tracking-[-0.006em] m-0">
              AgentLoop is built by agents — using the same harness engineering
              practices it covers.{" "}
              <Link
                to="/built"
                className="text-[#8c3a1e] border-b border-[#8c3a1e]"
              >
                See how it&apos;s built →
              </Link>
            </p>
          </div>
        </>
      ) : null}
      <hr className="border-0 border-t border-[#e7e2d6] m-0" />
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_1fr] gap-4 sm:gap-8 items-center pt-6 pb-2">
        <div className="font-mono uppercase text-[10.5px] tracking-[0.22em] text-[#6b6557]">
          <span className="flex items-center gap-2">
            <BrandMark size={18} className="shrink-0 text-[#8c3a1e]" />
            <strong className="text-[#14110d] font-semibold tracking-[0.16em]">
              AGENTLOOP
            </strong>
          </span>
          A{" "}
          <a
            href="https://blog.vertexcover.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#6b6557] underline decoration-dotted underline-offset-[3px] hover:text-[#14110d]"
          >
            Vertexcover Labs
          </a>{" "}
          publication
        </div>
        <div>
          <FooterSubscribeField />
        </div>
        <div className="font-mono uppercase text-[10.5px] tracking-[0.22em] text-[#6b6557] text-left sm:text-right">
          <Link to="/must-read" className="text-[#6b6557] hover:text-[#8c3a1e]">
            MUST READ
          </Link>
          <span className="mx-2 text-[#e7e2d6]">·</span>
          <Link to="/sources" className="text-[#6b6557] hover:text-[#8c3a1e]">
            SOURCES
          </Link>
          <span className="mx-2 text-[#e7e2d6]">·</span>
          <Link to="/built" className="text-[#6b6557] hover:text-[#8c3a1e]">
            HOW IT&apos;S BUILT
          </Link>
        </div>
      </div>
      <div className="py-5 text-center font-mono uppercase text-[10px] tracking-[0.22em] text-[#6b6557]">
        © {new Date().getFullYear()}{" "}
        <a
          href="https://blog.vertexcover.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#6b6557] underline decoration-dotted underline-offset-[3px] hover:text-[#14110d]"
        >
          Vertexcover Labs
        </a>
      </div>
    </footer>
  );
}

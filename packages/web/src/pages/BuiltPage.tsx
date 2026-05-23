import { useEffect, type ReactElement } from "react";
import { setMeta } from "../lib/meta";
import { PipelineDiagram } from "../components/built/PipelineDiagram";
import { DefinitionTable } from "../components/built/DefinitionTable";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";

export const LAST_REVIEWED = "2026-05-23";

const SKILLS = [
  { term: "brainstorm", def: "Structured problem exploration before any code." },
  {
    term: "spec-generation",
    def: "Turn design docs into testable SPECs with EARS-format acceptance criteria.",
  },
  { term: "planning", def: "Implementation plans broken into ordered, reviewable steps." },
  {
    term: "tdd",
    def: "Enforces RED-GREEN-REFACTOR loop. No production code without a failing test.",
  },
  {
    term: "code-review",
    def: "Two-pass review — independent reviewer never sees the implementer’s reasoning.",
  },
  {
    term: "verify",
    def: "Live functional verification — the app must actually run end-to-end.",
  },
  { term: "quality-gate", def: "Hard pass/fail thresholds on coverage, lint, typecheck." },
  {
    term: "sync-docs",
    def: "Updates documentation to match the implementation before commit.",
  },
  { term: "learn", def: "Captures hard-won insights into persistent learnings files." },
];

const AGENTS = [
  { term: "orchestrate", def: "Drives the full pipeline from spec to PR." },
  { term: "coder", def: "Writes the code under TDD discipline." },
  { term: "reviewer", def: "Reviews the diff. Runs twice, independently." },
  { term: "verifier", def: "Boots the app and proves features work." },
];

const ARTIFACTS: { code: string; def: string }[] = [
  { code: "spec.md", def: "EARS-format acceptance criteria — the testable contract." },
  { code: "plan.md", def: "Ordered implementation steps with rollback notes." },
  {
    code: "baseline.json",
    def: "Pre-change metrics: coverage, lint count, type errors.",
  },
  { code: "REVIEW-*.md", def: "Per-pass review reports with line-anchored findings." },
  {
    code: "quality-gate.md",
    def: "Pass/fail evidence with verbatim command output.",
  },
  { code: "proof-report.md", def: "Functional verification results with screenshots." },
];

function CodeTerm({ code }: { code: string }): ReactElement {
  return <code className="font-mono text-[12px] md:text-[13px] bg-transparent p-0">{code}</code>;
}

export function BuiltPage(): ReactElement {
  useEffect(() => {
    document.title = "How AgentLoop is built — AgentLoop";
    setMeta("description", "This newsletter writes itself. Almost.");
  }, []);

  return (
    <main className="font-serif">
      {/* ACT 1 — Manifesto */}
      <section className="pt-18 pb-6">
        <div className="max-w-[660px] mx-auto">
          <h1 className="font-serif font-medium text-[clamp(46px,7vw,84px)] leading-[1.02] tracking-[-0.018em] text-[#14110d] m-0 mb-[18px]">
            How AgentLoop is built
          </h1>
          <p className="font-serif italic font-normal text-[clamp(20px,2.2vw,26px)] leading-[1.35] text-[#6b6557] m-0 mb-12">
            This newsletter writes itself. Almost.
          </p>

          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7">
            THE ARGUMENT
          </p>

          <div data-section="argument">
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              Most AI products are written the way software was written in 2010: a human types,
              the machine compiles. That model is ending. The interesting work now is one layer
              up — building the <em className="italic">harness</em> around the model: the
              prompts, the tools, the loops, the evals, the context. The model is the engine.
              The harness is the car.
            </p>
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              We call this <strong className="font-semibold">harness engineering</strong>. It’s a
              real discipline, with its own primitives — context windows, agent loops, tool
              schemas, evaluation harnesses, scaffolds — and almost none of it is written down.
              Most of what exists is folklore, passed between practitioners on Twitter.
              AgentLoop is our attempt to make the folklore legible.
            </p>
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              The most honest way to argue for a discipline is to use it. So AgentLoop itself —
              the newsletter you’re reading — is built by agents, running inside a harness we
              designed. The agents pick sources, deduplicate, rank, summarise, and draft. A
              human reviews. The harness keeps them honest.
            </p>
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              Below is exactly how it works. The repo is open. The skills are open. Copy what’s
              useful.
            </p>
          </div>
        </div>

        <hr className="border-0 border-t-2 border-[#8c3a1e] my-20 mx-auto max-w-[880px]" />
      </section>

      {/* ACT 2 — Technical */}
      <section className="font-mono text-[14px] leading-[1.55]">
        {/* THE PIPELINE */}
        <div className="max-w-[920px] mx-auto pb-4">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE PIPELINE
          </p>
          <PipelineDiagram />
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* THE SKILLS */}
        <div className="max-w-[740px] mx-auto" data-section="skills">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE SKILLS
          </p>
          <DefinitionTable rows={SKILLS} ariaLabel="The Skills" />
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* THE AGENTS */}
        <div className="max-w-[740px] mx-auto" data-section="agents">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE AGENTS
          </p>
          <DefinitionTable rows={AGENTS} ariaLabel="The Agents" />
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* THE ARTIFACTS */}
        <div className="max-w-[740px] mx-auto" data-section="artifacts">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE ARTIFACTS
          </p>
          <DefinitionTable
            rows={ARTIFACTS.map((row) => ({
              term: <CodeTerm code={row.code} />,
              def: row.def,
            }))}
            ariaLabel="The Artifacts"
          />
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* THE GUARDRAILS */}
        <div className="max-w-[740px] mx-auto" data-section="guardrails">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE GUARDRAILS
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 max-w-[720px]">
            TDD is enforced — no production code without a failing test. Code review runs in two
            independent passes; the second reviewer never sees the first’s notes. The quality
            gate fails the run if coverage drops, lint warnings appear, or typecheck breaks.
            Functional verification boots the actual app and exercises the feature end-to-end.
            None of this is optional. The pipeline halts at the first gate failure and surfaces
            a structured failure report.
          </p>
        </div>

        {/* Closing block */}
        <section
          data-section="try-it"
          className="my-20 border-t border-b border-[#e7e2d6] py-12"
        >
          <div className="max-w-[740px] mx-auto">
            <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-5 text-left">
              TRY IT YOURSELF
            </p>
            <p className="font-serif text-[21px] leading-[1.55] text-[#14110d] m-0 mb-7 max-w-[640px]">
              Everything above is in the repo. The harness is reusable. If you build something
              with it, we’d like to hear about it.
            </p>
            <div className="flex gap-9 flex-wrap font-mono text-[12px] tracking-[0.12em] lowercase">
              <a
                href="https://github.com/vertexcover/agentloop"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#14110d] border-b border-[#e7e2d6] pb-[3px] hover:text-[#8c3a1e] hover:border-[#8c3a1e]"
              >
                → github.com/vertexcover/agentloop
              </a>
              <a
                href="mailto:hello@agentloop.vertexcover.io"
                className="text-[#14110d] border-b border-[#e7e2d6] pb-[3px] hover:text-[#8c3a1e] hover:border-[#8c3a1e]"
              >
                → hello@agentloop.vertexcover.io
              </a>
            </div>
          </div>
        </section>
      </section>
      <InlineSubscribeCard />
    </main>
  );
}

import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { setMeta } from "../lib/meta";
import { PipelineDiagram } from "../components/built/PipelineDiagram";
import { DefinitionTable } from "../components/built/DefinitionTable";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";

const LAST_REVIEWED = "2026-05-24";

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

const PILLARS: { num: string; title: string; body: string }[] = [
  {
    num: "01",
    title: "A spec sharp enough to fail against",
    body: "If “done” is a vibe, the only way to check the work is to read it. We write specs in EARS-format acceptance criteria so the verification step has something concrete to grade. No spec, no shipping.",
  },
  {
    num: "02",
    title: "A verification gate that proves it works",
    body: "Tests and typecheck are necessary, not sufficient. The harness boots the app, runs the feature end-to-end, captures payloads and screenshots, and writes a proof report before any commit. If the gate is weak, the code review you skipped comes back as a bug.",
  },
  {
    num: "03",
    title: "Compounding",
    body: "Every run has to leave the harness sharper than it found it — new tests, new lint rules, new learnings, retired skills. Without compounding, you’re not running a harness. You’re running a prompt twice.",
  },
];

const LOOPS: { tag: string; title: string; body: ReactElement }[] = [
  {
    tag: "WEEKLY",
    title: "Tech-debt sweep",
    body: (
      <>
        Every Friday the harness audits the repo for smells it’s learned about — N+1 queries,
        untyped boundaries, missing repository indirection — and opens fix PRs.
      </>
    ),
  },
  {
    tag: "PER PR",
    title: "Doc-sync loop",
    body: (
      <>
        Before any PR closes, a skill diffs the code against CLAUDE.md and the docs it claims
        to govern. Stale docs are a known failure mode of AI-authored code; we make the harness
        pay the cost of keeping them honest.
      </>
    ),
  },
  {
    tag: "CONTINUOUS",
    title: "Skill eval suite",
    body: (
      <>
        Every skill has a fixture suite it must pass. When a skill misfires in production, the
        failing case becomes a new fixture and the skill gets updated until it passes. The eval
        suite is the regression test for the harness itself.
      </>
    ),
  },
  {
    tag: "PER REPO",
    title: "Custom linters",
    body: (
      <>
        Project-specific rules — repository pattern, no relative cross-package imports,
        collector return shape, dotenv bootstrap order — each one captured the moment a bug
        taught us we needed it.
      </>
    ),
  },
  {
    tag: "PER BUG",
    title: "Learnings capture",
    body: (
      <>
        When a review catches something subtle, the lesson becomes a rule file under{" "}
        <code className="font-mono text-[15px]">.claude/rules/learnings/</code> and ships with
        every subsequent task. Each rule is a real bug that now prevents its own recurrence.
      </>
    ),
  },
];

const NEWSLETTER_ENTRIES: { term: string; def: ReactElement }[] = [
  {
    term: "SOURCES",
    def: (
      <>
        34+ feeds — HN, Reddit, Twitter, RSS, GitHub, company blogs. See the{" "}
        <Link
          to="/sources"
          className="text-[#8c3a1e] border-b border-[#e7e2d6] hover:border-[#8c3a1e]"
        >
          live reading list →
        </Link>
      </>
    ),
  },
  {
    term: "COLLECT",
    def: <>Each source has a collector. The harness wrote most of them.</>,
  },
  {
    term: "ENRICH + DEDUP",
    def: <>Links are fetched, summarised, and collapsed to one row per story.</>,
  },
  {
    term: "SHORTLIST",
    def: <>A cheap LLM pass picks ~30 candidates from a few hundred.</>,
  },
  {
    term: "RANK + RECAP",
    def: (
      <>
        A second pass scores the shortlist on <em>novelty</em>, <em>signal-vs-hype</em>,{" "}
        <em>actionability</em>, and writes the recap you read.
      </>
    ),
  },
  {
    term: "REVIEW",
    def: (
      <>A human spends a few minutes per issue confirming the agent didn’t ship something stupid.</>
    ),
  },
  {
    term: "SHIP",
    def: <>Archive page, email, LinkedIn, X — all from one run.</>,
  },
];

function CodeTerm({ code }: { code: string }): ReactElement {
  return <code className="font-mono text-[12px] md:text-[13px] bg-transparent p-0">{code}</code>;
}

export function BuiltPage(): ReactElement {
  useEffect(() => {
    document.title = "How AgentLoop is built — AgentLoop";
    setMeta(
      "description",
      "How the AgentLoop newsletter and the harness behind it are built.",
    );
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

          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE ARGUMENT
          </p>

          <div data-section="argument">
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              The interesting work in AI right now isn’t writing prompts. It’s building the{" "}
              <em className="italic">harness</em> around the model — the specs, the tools, the
              verification gates, the loops that keep it honest. The model is the engine. The
              harness is the car.
            </p>
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              We call this <strong className="font-semibold">harness engineering</strong>. It’s a
              real discipline, with its own primitives — context windows, agent loops, tool
              schemas, evaluation harnesses, scaffolds — and almost none of it is written down.
              Most of what exists is folklore, passed between practitioners on Twitter.
            </p>
            <p className="font-serif text-[19.5px] leading-[1.68] text-[#14110d] m-0 mb-[26px]">
              The most honest way to argue for a discipline is to use it. AgentLoop — the
              newsletter you’re reading — is built by agents running inside a harness we
              designed. The agents pick sources, deduplicate, rank, summarise, and draft. A
              human reviews. The harness keeps them honest. Below is exactly how it works.
            </p>

            <div className="font-mono text-[12px] text-[#6b6557] border-l-2 border-[#8c3a1e] pl-4 mt-7">
              Inspired by OpenAI’s <em className="italic">harness engineering</em> framing. This
              is one team’s attempt to put it into practice in public.
            </div>
          </div>
        </div>

        <hr className="border-0 border-t-2 border-[#8c3a1e] my-20 mx-auto max-w-[880px]" />
      </section>

      {/* ACT 2 — Technical */}
      <section className="font-mono text-[14px] leading-[1.55]">
        {/* 2. WHAT IT TAKES */}
        <div className="max-w-[660px] mx-auto pb-4" data-section="three-pillars">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            WHAT IT TAKES
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 mb-10">
            The honest goal of a harness is to ship code humans don’t read. That’s a strong
            claim. It only holds if three things hold first.
          </p>
          <div className="flex flex-col gap-9">
            {PILLARS.map((p) => (
              <div key={p.num} className="grid grid-cols-[56px_1fr] gap-5">
                <div className="font-mono text-[14px] tracking-[0.16em] uppercase text-[#8c3a1e] border-t-2 border-[#8c3a1e] pt-3">
                  {p.num}
                </div>
                <div>
                  <h3 className="font-serif text-[26px] leading-[1.2] text-[#14110d] m-0 mb-3">
                    {p.title}
                  </h3>
                  <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0">
                    {p.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* 3. THE SPEC → SHIP LOOP */}
        <div className="max-w-[920px] mx-auto pb-4">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE SPEC → SHIP LOOP
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 mb-10 max-w-[720px]">
            One feature, one pipeline. Each stage produces an artifact the next stage depends
            on. The whole thing runs unattended; a human reads the proof report at the end,
            not the diff.
          </p>
          <PipelineDiagram />
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* 4. THE COMPOUNDING LOOPS */}
        <div className="max-w-[740px] mx-auto" data-section="compounding">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            THE COMPOUNDING LOOPS
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 mb-8">
            The pipeline ships a feature. These loops keep the harness alive.
          </p>
          <div>
            {LOOPS.map((loop, idx) => (
              <div
                key={loop.tag}
                className={`grid grid-cols-[140px_1fr] gap-6 py-5 border-t border-[#e7e2d6]${
                  idx === LOOPS.length - 1 ? " border-b" : ""
                }`}
              >
                <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#8c3a1e]">
                  {loop.tag}
                </div>
                <div>
                  <h4 className="font-serif text-[22px] leading-[1.25] text-[#14110d] m-0 mb-2">
                    {loop.title}
                  </h4>
                  <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0">
                    {loop.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* 5. HOW THE NEWSLETTER WORKS */}
        <div className="max-w-[660px] mx-auto" data-section="newsletter">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            HOW THE NEWSLETTER WORKS
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 mb-4">
            The harness is one half. The newsletter pipeline it runs is the other.
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 mb-8">
            Once a day, an agent crawl runs across 34+ sources, dedups, ranks, summarises, and
            drafts an issue. A human spends a few minutes confirming nothing stupid is about to
            ship, and then it goes out.
          </p>
          <dl className="grid grid-cols-[120px_1fr] gap-x-6 gap-y-3 m-0">
            {NEWSLETTER_ENTRIES.map((entry) => (
              <div key={entry.term} className="contents">
                <dt className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#8c3a1e] pt-1">
                  {entry.term}
                </dt>
                <dd className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0">
                  {entry.def}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <hr className="border-0 border-t border-[#e7e2d6] my-14 mx-auto max-w-[920px]" />

        {/* 7. INSIDE THE HARNESS */}
        <div className="max-w-[740px] mx-auto" data-section="inside-harness">
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-7 text-left">
            INSIDE THE HARNESS
          </p>
          <p className="font-serif text-[18px] leading-[1.62] text-[#14110d] m-0 mb-7">
            If you want the inventory — every skill, agent, and artifact the pipeline uses —
            it’s all here. Most readers don’t need it on the first pass.
          </p>
          <details className="group">
            <summary className="font-mono text-[12px] tracking-[0.22em] uppercase text-[#8c3a1e] cursor-pointer list-none mb-7 hover:underline">
              Show the full inventory
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div data-section="skills">
                <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#6b6557] m-0 mb-3">
                  SKILLS
                </p>
                <DefinitionTable rows={SKILLS} ariaLabel="The Skills" />
              </div>
              <div data-section="agents">
                <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#6b6557] m-0 mb-3">
                  AGENTS
                </p>
                <DefinitionTable rows={AGENTS} ariaLabel="The Agents" />
              </div>
              <div data-section="artifacts">
                <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#6b6557] m-0 mb-3">
                  ARTIFACTS
                </p>
                <DefinitionTable
                  rows={ARTIFACTS.map((row) => ({
                    term: <CodeTerm code={row.code} />,
                    def: row.def,
                  }))}
                  ariaLabel="The Artifacts"
                />
              </div>
            </div>
          </details>
        </div>

        {/* 8. VERTEXCOVER LABS */}
        <section
          data-section="vertexcover-labs"
          className="max-w-[660px] mx-auto border-t border-b border-[#e7e2d6] py-8 mt-14"
        >
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-5 text-left">
            VERTEXCOVER LABS
          </p>
          <p className="font-serif text-[17px] leading-[1.62] text-[#6b6557] m-0">
            <strong className="font-semibold text-[#14110d]">Vertexcover Labs</strong> is the
            R&amp;D arm of Vertexcover. We build production systems for clients and publish
            what we learn here. AgentLoop is one such system — built in the open, with the same
            harness we use on client work.{" "}
            <a
              href="https://blog.vertexcover.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#8c3a1e] border-b border-[#e7e2d6] hover:border-[#8c3a1e]"
            >
              More from the Labs →
            </a>
          </p>
        </section>

        {/* 9. TRY IT YOURSELF */}
        <section
          data-section="try-it"
          className="my-20 border-t border-b border-[#e7e2d6] py-12"
        >
          <div className="max-w-[740px] mx-auto">
            <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] m-0 mb-5 text-left">
              TRY IT YOURSELF
            </p>
            <p className="font-serif text-[21px] leading-[1.55] text-[#14110d] m-0 mb-7 max-w-[640px]">
              The repos are open. The skills are open. Copy what’s useful.
            </p>
            <div className="flex gap-9 flex-wrap font-mono text-[12px] tracking-[0.12em] lowercase">
              <a
                href="https://github.com/vertexcover-io/ai-news-aggregator"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#14110d] border-b border-[#e7e2d6] pb-[3px] hover:text-[#8c3a1e] hover:border-[#8c3a1e]"
              >
                → github.com/vertexcover-io/ai-news-aggregator
              </a>
              <a
                href="https://github.com/vertexcover-io/harness-engineering"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#14110d] border-b border-[#e7e2d6] pb-[3px] hover:text-[#8c3a1e] hover:border-[#8c3a1e]"
              >
                → github.com/vertexcover-io/harness-engineering
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

import { useRef, useEffect, Fragment } from "react";
import type { ReactElement, RefObject } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowDown,
  Zap,
  Layers,
  Filter,
  ListOrdered,
  Globe,
  Mail,
  Sparkles,
  Lightbulb,
  Rss,
  Send,
  User,
  Users,
  Building2,
  Plus,
  Check,
  Eye,
  Archive,
  BarChart3,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { siYcombinator, siReddit, siX } from "simple-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/magicui/blur-fade";
import { WordRotate } from "@/components/magicui/word-rotate";
import { Marquee } from "@/components/magicui/marquee";
import { DotPattern } from "@/components/magicui/dot-pattern";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { BrandMark } from "@/components/shell/BrandMark";

// A glyph is either a real brand mark (raw SVG path + brand colour) or a
// generic lucide icon — one renderer (`Mark`) handles both.
type Glyph =
  | { kind: "brand"; path: string; hex: string }
  | { kind: "icon"; icon: LucideIcon };

// LinkedIn isn't in simple-icons (brand policy), so its mark is inlined.
const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

const brand = (icon: { path: string; hex: string }): Glyph => ({
  kind: "brand",
  path: icon.path,
  hex: icon.hex,
});

const TOPICS = [
  "A.I.",
  "climate",
  "markets",
  "design",
  "sports",
  "biotech",
] as const;

const STRIP_TOPICS = [
  "A.I.",
  "Markets",
  "Climate",
  "Design",
  "Biotech",
  "Local news",
  "Sports",
  "Politics",
  "Startups",
  "Culture",
];

// Sources, top → bottom — three real platforms plus the open web.
const SOURCES: readonly { glyph: Glyph; label: string }[] = [
  { glyph: brand(siYcombinator), label: "Hacker News" },
  { glyph: brand(siReddit), label: "Reddit" },
  { glyph: brand(siX), label: "X" },
  { glyph: { kind: "icon", icon: Globe }, label: "The web" },
];

// Delivery channels, top → bottom.
const CHANNELS: readonly { glyph: Glyph; label: string }[] = [
  { glyph: { kind: "icon", icon: Mail }, label: "Email" },
  { glyph: brand(siX), label: "X" },
  { glyph: { kind: "brand", path: LINKEDIN_PATH, hex: "0A66C2" }, label: "LinkedIn" },
  { glyph: { kind: "icon", icon: Archive }, label: "Web archive" },
];

const STAGES: readonly { icon: LucideIcon; label: string; blurb: string }[] = [
  { icon: Layers, label: "Dedupe", blurb: "Repeats and near-duplicates merged into one." },
  { icon: Filter, label: "Shortlist", blurb: "Only what's worth your readers' time survives." },
  { icon: ListOrdered, label: "Ranked", blurb: "Scored and ordered so the best story leads." },
];

const YOU: readonly { icon: LucideIcon; title: string; blurb: string }[] = [
  {
    icon: Lightbulb,
    title: "Pick your topic",
    blurb: "Choose the subject your newsletter will cover.",
  },
  {
    icon: Rss,
    title: "Add your sources",
    blurb: "The sites, feeds, and writers you already trust.",
  },
  {
    icon: Send,
    title: "Hit send",
    blurb: "Skim the draft, give it a nod, and it's out the door.",
  },
];

const DISPATCH: readonly { icon: LucideIcon; text: string }[] = [
  { icon: Sparkles, text: "Reads every source you choose, then dedupes and ranks with AI" },
  { icon: Globe, text: "Hosts it on your domain and brand, with SSL included" },
  { icon: Send, text: "Delivers to every inbox and archives every digest" },
];

// What the operator (our client) gets vs. what their subscribers receive.
const FOR_YOU: readonly string[] = [
  "AI curation across every source you choose",
  "Your brand, your domain, your sender",
  "Full editorial control before anything ships",
  "Open and click analytics on every send",
  "One draft, published to email, X, and LinkedIn",
];

const FOR_READERS: readonly string[] = [
  "A clean, branded digest in their own inbox",
  "Only the stories that matter, ranked first",
  "A searchable archive of every past digest",
  "One tap to subscribe or unsubscribe",
  "Your name on every send, never ours",
];

// The kinds of operators who run a Dispatch newsletter.
const WHO: readonly { icon: LucideIcon; title: string }[] = [
  { icon: User, title: "Solo writers" },
  { icon: Users, title: "Communities" },
  { icon: Building2, title: "Teams" },
];

// Bento of everything that ships in the box. The first card is the hero
// (spans two rows on the left); the rest fill a 6-column grid beside it.
const FEATURES: readonly {
  icon: LucideIcon;
  title: string;
  blurb: string;
  span: string;
  hero?: boolean;
}[] = [
  {
    icon: Sparkles,
    title: "AI reads it all, every day",
    blurb:
      "Each morning Dispatch scans the sources you pick, strips duplicates, and ranks what's left, so only the strongest stories reach your draft.",
    span: "md:col-span-4 md:row-span-2",
    hero: true,
  },
  {
    icon: Globe,
    title: "Your brand, your domain",
    blurb: "Your own domain with SSL, sent from your address. Readers never see us.",
    span: "md:col-span-2",
  },
  {
    icon: Eye,
    title: "You're the editor",
    blurb: "Reorder, cut, or rewrite any digest. Nothing ships without your nod.",
    span: "md:col-span-2",
  },
  {
    icon: Archive,
    title: "Every digest, archived",
    blurb: "A searchable home for everything you've published.",
    span: "md:col-span-2",
  },
  {
    icon: BarChart3,
    title: "Opens and clicks",
    blurb: "See what landed and what readers tapped.",
    span: "md:col-span-2",
  },
  {
    icon: CalendarClock,
    title: "On your schedule",
    blurb: "Daily, weekly, or whenever you choose to ship.",
    span: "md:col-span-2",
  },
];

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "Where do the stories come from?",
    a: "From the sources you choose: sites, feeds, and platforms like Hacker News, Reddit, and the open web. Dispatch reads them every day so you don't have to.",
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. Launch free on yoursite.dispatch.co, or connect a custom domain. SSL is handled automatically.",
  },
  {
    q: "Do I own my subscribers?",
    a: "Always. Your list is yours to export anytime, and we never email your readers on our own behalf.",
  },
  {
    q: "How automated is it, really?",
    a: "The reading, deduping, and ranking happen on their own. You stay the editor: review, reorder, and approve before anything goes out.",
  },
  {
    q: "Can I post to social too?",
    a: "Yes. The same digest can publish to X and LinkedIn alongside the email send.",
  },
];

function Mark({
  glyph,
  className,
}: {
  glyph: Glyph;
  className?: string;
}): ReactElement {
  if (glyph.kind === "icon") {
    const Icon = glyph.icon;
    return <Icon className={cn("text-rust", className)} strokeWidth={2} />;
  }
  return (
    <svg role="img" aria-hidden viewBox="0 0 24 24" className={className}>
      <path d={glyph.path} fill={`#${glyph.hex}`} />
    </svg>
  );
}

function Wordmark({ className }: { className?: string }): ReactElement {
  return (
    <Link to="/" className={cn("flex items-center gap-2", className)}>
      <BrandMark
        size={26}
        className="shrink-0 -translate-y-px text-rust"
        label="Dispatch"
      />
      <span className="font-mono text-[15px] font-semibold uppercase leading-none tracking-[0.14em] text-ink">
        Dispatch
      </span>
    </Link>
  );
}

function Nav(): ReactElement {
  const links = [
    { href: "#how", label: "How it works" },
    { href: "#features", label: "What's included" },
    { href: "#who", label: "Who it's for" },
    { href: "#faq", label: "FAQ" },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-cream/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Wordmark />
        <nav className="hidden items-center gap-7 text-[14.5px] text-ink-2 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-rust">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild className="text-ink-2 hover:text-rust">
            <Link to="/admin/login">Log in</Link>
          </Button>
          <Button variant="rust" asChild>
            <Link to="/signup">Start your newsletter</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function SectionHead({
  eyebrow,
  title,
  blurb,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
  dark?: boolean;
}): ReactElement {
  return (
    <BlurFade className="mx-auto mb-14 max-w-2xl text-center">
      <span
        className={cn(
          "font-mono text-xs uppercase tracking-[0.16em]",
          dark ? "text-[#e9a07f]" : "text-rust",
        )}
      >
        {eyebrow}
      </span>
      <h2
        className={cn(
          "mt-3 font-serif text-[clamp(30px,4vw,44px)] font-medium tracking-tight",
          dark ? "text-cream" : "text-ink",
        )}
      >
        {title}
      </h2>
      {blurb !== undefined && (
        <p className={cn("mt-4", dark ? "text-cream/70" : "text-ink-2")}>{blurb}</p>
      )}
    </BlurFade>
  );
}

function Hero(): ReactElement {
  const reduced = useReducedMotion();
  return (
    <section className="relative overflow-hidden border-b border-line">
      <DotPattern className="[mask-image:radial-gradient(560px_circle_at_center,white,transparent)]" />
      <div className="relative mx-auto max-w-6xl px-6 py-24 text-center md:py-32">
        <BlurFade delay={0.12} inView={false}>
          <h1 className="mx-auto max-w-[16ch] font-serif text-[clamp(42px,7vw,76px)] font-medium leading-[1.04] tracking-tight text-ink">
            Start a newsletter about{" "}
            {reduced ? (
              <span className="italic text-rust">anything</span>
            ) : (
              // Fixed-width slot sized to the widest topic so the words before
              // it ("about") never shift as the rotation changes width.
              <span className="relative inline-block whitespace-nowrap align-bottom">
                <span aria-hidden className="invisible italic">
                  markets
                </span>
                <span className="absolute inset-0 flex items-baseline">
                  <WordRotate words={[...TOPICS]} className="italic text-rust" />
                </span>
              </span>
            )}
          </h1>
        </BlurFade>
        <BlurFade delay={0.2} inView={false}>
          <p className="mx-auto mt-6 max-w-[48ch] text-lg text-ink-2 md:text-xl">
            Pick your sources. We read everything, rank what matters, and send a
            sharp daily digest in your own brand.
          </p>
        </BlurFade>
        <BlurFade delay={0.28} inView={false}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button variant="rust" size="lg" asChild>
              <Link to="/signup">
                Start your newsletter <ArrowRight />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/admin/login">Log in</Link>
            </Button>
          </div>
        </BlurFade>
        <BlurFade delay={0.36} inView={false}>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs text-mute">
            {["Free to start", "Own your audience", "No code"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-rust" />
                {t}
              </span>
            ))}
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function TopicStrip(): ReactElement {
  return (
    <div className="border-b border-line bg-chip py-5">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6">
        <span className="hidden shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-mute sm:block">
          For any topic
        </span>
        <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <Marquee pauseOnHover className="[--duration:34s] [--gap:1.4rem]">
            {STRIP_TOPICS.map((topic) => (
              <span key={topic} className="font-serif text-lg italic text-ink-2">
                {topic}
                <span className="ml-[1.4rem] not-italic text-line-strong">·</span>
              </span>
            ))}
          </Marquee>
        </div>
      </div>
    </div>
  );
}

function NodeCircle({
  nodeRef,
  icon: Icon,
  label,
  anchor = false,
}: {
  nodeRef: RefObject<HTMLDivElement | null>;
  icon: LucideIcon;
  label: string;
  anchor?: boolean;
}): ReactElement {
  return (
    <div className="relative flex shrink-0 flex-col items-center">
      <div
        ref={nodeRef}
        className={cn(
          "z-10 flex h-14 w-14 items-center justify-center rounded-full border shadow-sm",
          anchor
            ? "border-rust-deep bg-rust text-cream"
            : "border-line-strong bg-cream-elev text-rust",
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <span className="absolute top-full mt-2.5 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
        {label}
      </span>
    </div>
  );
}

function Pill({
  nodeRef,
  glyph,
  label,
  width = "w-44",
}: {
  nodeRef: RefObject<HTMLDivElement | null>;
  glyph: Glyph;
  label: string;
  width?: string;
}): ReactElement {
  return (
    <div
      ref={nodeRef}
      className={cn(
        "z-10 flex items-center gap-2.5 rounded-lg border border-line-strong bg-cream-elev px-3.5 py-2.5 shadow-sm",
        width,
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cream">
        <Mark glyph={glyph} className="h-[15px] w-[15px]" />
      </span>
      <span className="font-sans text-[13px] font-medium text-ink-2">{label}</span>
    </div>
  );
}

function GroupCard({
  title,
  children,
}: {
  title: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-line bg-cream/60 p-3">
      <span className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-mute-2">
        {title}
      </span>
      {children}
    </div>
  );
}

function SystemDiagram(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const s0 = useRef<HTMLDivElement>(null);
  const s1 = useRef<HTMLDivElement>(null);
  const s2 = useRef<HTMLDivElement>(null);
  const s3 = useRef<HTMLDivElement>(null);
  const dedupRef = useRef<HTMLDivElement>(null);
  const shortRef = useRef<HTMLDivElement>(null);
  const rankRef = useRef<HTMLDivElement>(null);
  const c0 = useRef<HTMLDivElement>(null);
  const c1 = useRef<HTMLDivElement>(null);
  const c2 = useRef<HTMLDivElement>(null);
  const c3 = useRef<HTMLDivElement>(null);
  const sourceRefs = [s0, s1, s2, s3];
  const channelRefs = [c0, c1, c2, c3];

  return (
    <div
      ref={containerRef}
      className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-3 py-8"
    >
      <NodeCircle nodeRef={startRef} icon={Zap} label="Daily run" anchor />

      <GroupCard title="Sources">
        {SOURCES.map((source, i) => (
          <Pill key={source.label} nodeRef={sourceRefs[i]} glyph={source.glyph} label={source.label} />
        ))}
      </GroupCard>

      <NodeCircle nodeRef={dedupRef} icon={Layers} label="Dedupe" />
      <NodeCircle nodeRef={shortRef} icon={Filter} label="Shortlist" />
      <NodeCircle nodeRef={rankRef} icon={ListOrdered} label="Ranked" anchor />

      <GroupCard title="Delivered to">
        {CHANNELS.map((channel, i) => (
          <Pill key={channel.label} nodeRef={channelRefs[i]} glyph={channel.glyph} label={channel.label} width="w-36" />
        ))}
      </GroupCard>

      {/* fan-out: daily run (right edge) → each source (left edge), convex */}
      <AnimatedBeam containerRef={containerRef} fromRef={startRef} toRef={s0} startXOffset={28} endXOffset={-88} curvature={55} duration={3} delay={0} />
      <AnimatedBeam containerRef={containerRef} fromRef={startRef} toRef={s1} startXOffset={28} endXOffset={-88} curvature={18} duration={3} delay={0.15} />
      <AnimatedBeam containerRef={containerRef} fromRef={startRef} toRef={s2} startXOffset={28} endXOffset={-88} curvature={-18} duration={3} delay={0.3} />
      <AnimatedBeam containerRef={containerRef} fromRef={startRef} toRef={s3} startXOffset={28} endXOffset={-88} curvature={-55} duration={3} delay={0.45} />
      {/* converge: each source (right edge) → dedupe (left edge), convex */}
      <AnimatedBeam containerRef={containerRef} fromRef={s0} toRef={dedupRef} startXOffset={88} endXOffset={-28} curvature={55} duration={3} delay={0.5} />
      <AnimatedBeam containerRef={containerRef} fromRef={s1} toRef={dedupRef} startXOffset={88} endXOffset={-28} curvature={18} duration={3} delay={0.65} />
      <AnimatedBeam containerRef={containerRef} fromRef={s2} toRef={dedupRef} startXOffset={88} endXOffset={-28} curvature={-18} duration={3} delay={0.8} />
      <AnimatedBeam containerRef={containerRef} fromRef={s3} toRef={dedupRef} startXOffset={88} endXOffset={-28} curvature={-55} duration={3} delay={0.95} />
      {/* chain: dedupe → shortlist → ranked (edge to edge) */}
      <AnimatedBeam containerRef={containerRef} fromRef={dedupRef} toRef={shortRef} startXOffset={28} endXOffset={-28} duration={3} delay={1.1} />
      <AnimatedBeam containerRef={containerRef} fromRef={shortRef} toRef={rankRef} startXOffset={28} endXOffset={-28} duration={3} delay={1.3} />
      {/* deliver: ranked (right edge) → each channel (left edge), convex */}
      <AnimatedBeam containerRef={containerRef} fromRef={rankRef} toRef={c0} startXOffset={28} endXOffset={-72} curvature={55} duration={3} delay={1.5} />
      <AnimatedBeam containerRef={containerRef} fromRef={rankRef} toRef={c1} startXOffset={28} endXOffset={-72} curvature={18} duration={3} delay={1.65} />
      <AnimatedBeam containerRef={containerRef} fromRef={rankRef} toRef={c2} startXOffset={28} endXOffset={-72} curvature={-18} duration={3} delay={1.8} />
      <AnimatedBeam containerRef={containerRef} fromRef={rankRef} toRef={c3} startXOffset={28} endXOffset={-72} curvature={-55} duration={3} delay={1.95} />
    </div>
  );
}

function SystemDiagramMobile(): ReactElement {
  return (
    <div className="flex flex-col items-stretch gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-rust-deep bg-rust px-4 py-3 text-cream">
        <Zap className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        <span className="font-mono text-xs uppercase tracking-[0.12em]">Daily run</span>
      </div>
      <span className="mx-auto h-4 w-px bg-line-strong" />
      <div className="rounded-lg border border-line bg-cream/60 p-3">
        <span className="mb-2 block text-center font-mono text-[10px] uppercase tracking-[0.14em] text-mute-2">
          Sources
        </span>
        <div className="grid grid-cols-2 gap-2">
          {SOURCES.map((source) => (
            <div
              key={source.label}
              className="flex items-center gap-2 rounded-md border border-line-strong bg-cream-elev px-2.5 py-2"
            >
              <Mark glyph={source.glyph} className="h-4 w-4 shrink-0" />
              <span className="text-[12.5px] font-medium text-ink-2">{source.label}</span>
            </div>
          ))}
        </div>
      </div>
      {STAGES.map((stage, i) => (
        <div key={stage.label} className="flex flex-col items-stretch gap-3">
          <span className="mx-auto h-4 w-px bg-line-strong" />
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border",
                i === STAGES.length - 1
                  ? "border-rust-deep bg-rust text-cream"
                  : "border-line-strong bg-cream-elev text-rust",
              )}
            >
              <stage.icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="text-left">
              <h3 className="font-serif text-base text-ink">{stage.label}</h3>
              <p className="text-[13px] leading-snug text-mute">{stage.blurb}</p>
            </div>
          </div>
        </div>
      ))}
      <span className="mx-auto h-4 w-px bg-line-strong" />
      <div className="rounded-lg border border-line bg-cream/60 p-3">
        <span className="mb-2 block text-center font-mono text-[10px] uppercase tracking-[0.14em] text-mute-2">
          Delivered to
        </span>
        <div className="grid grid-cols-2 gap-2">
          {CHANNELS.map((channel) => (
            <div
              key={channel.label}
              className="flex items-center justify-center gap-2 rounded-md border border-line-strong bg-cream-elev px-2 py-2"
            >
              <Mark glyph={channel.glyph} className="h-4 w-4 shrink-0" />
              <span className="text-[12px] font-medium text-ink-2">{channel.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HowItWorks(): ReactElement {
  return (
    <section id="how" className="py-24 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHead
          eyebrow="How it works"
          title="How a digest gets made."
          blurb="Every day, dozens of sources become one sharp digest, delivered everywhere you publish."
        />
        <BlurFade delay={0.1}>
          <div className="rounded-2xl border border-line-strong bg-cream-elev px-4 pb-8 pt-6 shadow-[0_1px_0_var(--color-line)]">
            <div className="hidden md:block">
              <SystemDiagram />
            </div>
            <div className="pt-6 md:hidden">
              <SystemDiagramMobile />
            </div>
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function SoloSection(): ReactElement {
  return (
    <section
      id="features"
      className="border-t border-line bg-cream-elev py-24 md:py-28"
    >
      <div className="mx-auto max-w-4xl px-6">
        <SectionHead
          eyebrow="What's included"
          title="You Choose the Sources. We Handle the Workflow"
        />
        <div className="grid gap-6 md:grid-cols-2">
          {/* YOU — numbered steps with separators + flow arrows */}
          <BlurFade>
            <div className="flex h-full flex-col rounded-3xl border border-line-strong bg-chip p-7 shadow-[0_14px_44px_-22px_rgba(20,17,13,0.28)]">
              <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-rust">
                You
              </span>
              <div className="mt-6 flex flex-col">
                {YOU.map((item, i) => (
                  <Fragment key={item.title}>
                    <div className="flex gap-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rust font-mono text-sm font-semibold text-cream">
                        {i + 1}
                      </div>
                      <div>
                        <h3 className="font-serif text-lg text-ink">{item.title}</h3>
                        <p className="mt-1 text-sm leading-snug text-mute">
                          {item.blurb}
                        </p>
                      </div>
                    </div>
                    {i < YOU.length - 1 && (
                      <div className="relative my-4 border-t border-line-strong/70">
                        <span className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-chip text-mute-2">
                          <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            </div>
          </BlurFade>
          {/* DISPATCH — 3 full-width rows, larger icons, checkmarks */}
          <BlurFade delay={0.1}>
            <div className="flex h-full flex-col rounded-3xl bg-ink p-7 shadow-[0_18px_50px_-24px_rgba(20,17,13,0.55)]">
              <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-[#e9a07f]">
                Dispatch handles
              </span>
              <div className="mt-4 flex flex-1 flex-col justify-center">
                {DISPATCH.map((item, i) => (
                  <div
                    key={item.text}
                    className={cn(
                      "flex items-center gap-4 py-4",
                      i < DISPATCH.length - 1 && "border-b border-white/10",
                    )}
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
                      <item.icon className="h-6 w-6 text-[#e9a07f]" strokeWidth={1.75} />
                    </span>
                    <span className="flex-1 text-[15px] leading-snug text-cream/90">
                      {item.text}
                    </span>
                    <Check className="h-4 w-4 shrink-0 text-[#e9a07f]" strokeWidth={2.5} />
                  </div>
                ))}
              </div>
            </div>
          </BlurFade>
        </div>
      </div>
    </section>
  );
}

function PanelCard({
  label,
  items,
  dark = false,
}: {
  label: string;
  items: readonly string[];
  dark?: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-3xl p-8",
        dark
          ? "bg-ink shadow-[0_18px_50px_-24px_rgba(20,17,13,0.55)]"
          : "border border-line-strong bg-cream-elev",
      )}
    >
      <span
        className={cn(
          "font-mono text-[13px] font-semibold uppercase tracking-[0.14em]",
          dark ? "text-[#e9a07f]" : "text-rust",
        )}
      >
        {label}
      </span>
      <ul className="mt-6 flex flex-1 flex-col gap-3.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <Check
              className={cn(
                "mt-[3px] h-4 w-4 shrink-0",
                dark ? "text-[#e9a07f]" : "text-rust",
              )}
              strokeWidth={2.5}
            />
            <span
              className={cn(
                "text-[15px] leading-snug",
                dark ? "text-cream/85" : "text-ink-2",
              )}
            >
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhoSection(): ReactElement {
  return (
    <section id="who" className="py-24 md:py-28">
      <div className="mx-auto max-w-5xl px-6">
        <SectionHead
          eyebrow="Publisher and reader"
          title="What you get. What your readers get."
          blurb="Dispatch gives you a full editorial workflow. It gives your readers a digest worth opening, sent in your name."
        />
        <div className="grid gap-6 md:grid-cols-2">
          <BlurFade>
            <PanelCard label="For you, the publisher" items={FOR_YOU} />
          </BlurFade>
          <BlurFade delay={0.1}>
            <PanelCard label="For your readers" items={FOR_READERS} dark />
          </BlurFade>
        </div>
        <BlurFade delay={0.16}>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-line bg-chip px-6 py-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute-2">
              Run by
            </span>
            {WHO.map((w) => (
              <span
                key={w.title}
                className="flex items-center gap-2 rounded-full border border-line-strong bg-cream-elev px-3.5 py-1.5"
              >
                <w.icon className="h-4 w-4 text-rust" strokeWidth={1.75} />
                <span className="text-[13.5px] font-medium text-ink-2">{w.title}</span>
              </span>
            ))}
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function FeaturesBento(): ReactElement {
  return (
    <section className="border-t border-line bg-cream py-24 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHead
          eyebrow="Everything included"
          title="Everything you need, included."
          blurb="The complete publishing workflow in one platform, with no plugins or integrations to manage."
        />
        <div className="grid auto-rows-[minmax(0,1fr)] gap-4 md:grid-cols-6">
          {FEATURES.map((f, i) => (
            <BlurFade key={f.title} delay={0.06 * i} className={f.span}>
              <div
                className={cn(
                  "flex h-full flex-col rounded-2xl border p-7",
                  f.hero
                    ? "border-rust-deep/40 bg-ink shadow-[0_18px_50px_-24px_rgba(20,17,13,0.55)]"
                    : "border-line-strong bg-cream-elev",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-xl",
                    f.hero ? "h-12 w-12 bg-white/[0.06]" : "h-11 w-11 bg-chip",
                  )}
                >
                  <f.icon
                    className={cn(f.hero ? "h-6 w-6 text-[#e9a07f]" : "h-5 w-5 text-rust")}
                    strokeWidth={1.75}
                  />
                </span>
                <h3
                  className={cn(
                    "mt-5 font-serif tracking-tight",
                    f.hero ? "text-2xl text-cream" : "text-xl text-ink",
                  )}
                >
                  {f.title}
                </h3>
                <p
                  className={cn(
                    "mt-2 leading-relaxed",
                    f.hero ? "text-[15px] text-cream/70" : "text-[14.5px] text-mute",
                  )}
                >
                  {f.blurb}
                </p>
                {f.hero === true && (
                  <div className="mt-auto flex flex-wrap gap-2 pt-7">
                    {SOURCES.map((s) => (
                      <span
                        key={s.label}
                        className="flex items-center gap-1.5 rounded-md bg-cream-elev px-2.5 py-1.5"
                      >
                        <Mark glyph={s.glyph} className="h-3.5 w-3.5" />
                        <span className="font-mono text-[11px] text-ink-2">{s.label}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection(): ReactElement {
  return (
    <section id="faq" className="py-24 md:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHead eyebrow="FAQ" title="Questions, answered." />
        <BlurFade delay={0.1}>
          <div className="border-t border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-line py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <span className="font-serif text-lg text-ink">{item.q}</span>
                  <Plus
                    className="faq-toggle h-5 w-5 shrink-0 text-rust"
                    strokeWidth={1.75}
                  />
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mute">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function FinalCta(): ReactElement {
  return (
    <section className="border-t border-line bg-chip py-28 text-center">
      <div className="mx-auto max-w-6xl px-6">
        <BlurFade>
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-rust">
            Start today
          </span>
          <h2 className="mx-auto mt-3 max-w-[18ch] font-serif text-[clamp(34px,5vw,52px)] font-medium tracking-tight text-ink">
            Your readers are waiting.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg text-ink-2">
            Set up your newsletter in minutes. Free to start.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button variant="rust" size="lg" asChild>
              <Link to="/signup">
                Start your newsletter <ArrowRight />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/admin/login">Log in</Link>
            </Button>
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function Footer(): ReactElement {
  return (
    <footer className="border-t border-line bg-cream">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-7">
        <Wordmark />
        <nav className="flex flex-wrap gap-6 text-sm text-mute">
          <a href="#how" className="hover:text-rust">
            How it works
          </a>
          <a href="#features" className="hover:text-rust">
            What's included
          </a>
          <a href="#who" className="hover:text-rust">
            Who it's for
          </a>
          <a href="#faq" className="hover:text-rust">
            FAQ
          </a>
          <Link to="/admin/login" className="hover:text-rust">
            Log in
          </Link>
        </nav>
        <span className="font-mono text-[11.5px] tracking-wide text-mute-2">
          © 2026 Dispatch · placeholder wordmark
        </span>
      </div>
    </footer>
  );
}

export function LandingPage(): ReactElement {
  useEffect(() => {
    document.title = "Dispatch · Start a newsletter about anything";
  }, []);
  return (
    <div className="min-h-screen bg-cream font-sans text-ink antialiased">
      <Nav />
      <main>
        <Hero />
        <TopicStrip />
        <HowItWorks />
        <SoloSection />
        <WhoSection />
        <FeaturesBento />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

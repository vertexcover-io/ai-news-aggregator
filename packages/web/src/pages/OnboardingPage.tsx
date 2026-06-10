import { useState, useEffect, type ReactElement, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { OnboardingState } from "@newsletter/shared/types";
import {
  getOnboarding,
  patchOnboarding,
  checkSlugAvailable,
  generatePrompts,
  discoverSources,
  activateTenant,
} from "@/api/onboarding";

// ── Step definition ─────────────────────────────────────────────────────────

interface StepDefinition {
  id: keyof OnboardingState;
  label: string;
  required: boolean;
}

const STEPS: StepDefinition[] = [
  { id: "name", label: "Name & slug", required: true },
  { id: "slug", label: "Slug", required: true },
  { id: "branding", label: "Homepage text", required: true },
  { id: "prompts", label: "Prompts", required: true },
  { id: "sources", label: "Sources", required: true },
  { id: "schedule", label: "Schedule", required: true },
  { id: "social", label: "Social", required: false },
  { id: "email", label: "Email", required: false },
];

// ── Preview pane ────────────────────────────────────────────────────────────

interface PreviewProps {
  name: string;
  slug: string;
  headline: string;
  topicStrip: string;
  subtagline: string;
}

function PreviewPane({ name, slug, headline, topicStrip, subtagline }: PreviewProps): ReactElement {
  const displayName = name || "Your Newsletter";
  const displaySlug = slug || "your-slug";
  const displayHeadline = headline || "The daily read for people who ship with agents.";
  const displayStrip = topicStrip;
  const displaySubtag = subtagline;

  return (
    <div className="preview-col">
      <div className="pv-label">
        Preview
        <span className="text-[10px] font-mono text-mute">
          {displaySlug}.vertexcover.io
        </span>
      </div>
      <div className="browser">
        <div className="bar">
          <div className="dots">
            <i />
            <i />
            <i />
          </div>
          <div className="url">
            <b>{displaySlug}</b>.vertexcover.io
          </div>
        </div>
        <div className="pv-body">
          {/* Masthead */}
          <div className="pv-mast">
            <div className="pv-brand">
              <div className={name ? "pv-logo has-img" : "pv-logo"}>
                {name ? name.charAt(0).toUpperCase() : "?"}
              </div>
              <span id="pvWord">{displayName.toUpperCase()}</span>
            </div>
            <div className="pv-nav">
              <b>Sources</b> &middot; Must Read &middot; How it&apos;s Built
            </div>
          </div>

          {/* Hero */}
          <div className="pv-hero">
            <div id="pvHead">{displayHeadline}</div>
            {displayStrip ? (
              <div className="pv-sub">{displayStrip}</div>
            ) : null}
            {displaySubtag ? (
              <div className="pv-sub" style={{ marginTop: "8px" }}>
                {displaySubtag}
              </div>
            ) : null}
          </div>

          {/* Today's Issue — lorem ipsum placeholder */}
          <div className="pv-issue">
            <span className="tag">Today&apos;s Issue</span>
            <div className="skel" />
            <div className="skel" style={{ width: "75%" }} />
            <div className="skel" style={{ width: "60%" }} />
          </div>

          {/* Recent archives — placeholder rows */}
          <div className="pv-arch">
            {Array.from({ length: 3 }).map((_, i) => (
              <div className="rowi" key={i}>
                <div className="ti">Lorem ipsum dolor sit amet consectetur</div>
                <div className="dt">Jun {9 - i}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Slug validation helper ──────────────────────────────────────────────────

function SlugField({
  slug,
  setSlug,
  debouncedSlug,
}: {
  slug: string;
  setSlug: (v: string) => void;
  debouncedSlug: string;
}): ReactElement {
  const { data: slugResult } = useQuery({
    queryKey: ["slug-available", debouncedSlug],
    queryFn: () => checkSlugAvailable(debouncedSlug),
    enabled: debouncedSlug.length >= 2,
  });

  return (
    <div>
      <label className="block text-sm font-medium mb-1">Slug</label>
      <div className="flex items-center gap-2">
        <span className="text-mute text-sm">your.vertexcover.io/</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }}
          className="flex-1 border border-line rounded-md px-3 py-2 text-sm font-mono"
          placeholder="my-newsletter"
          maxLength={63}
        />
      </div>
      {debouncedSlug.length >= 2 && (
        <div
          className={`avail ${slugResult?.available ? "ok" : "bad"}`}
        >
          {slugResult?.available
            ? "Available"
            : slugResult?.reason === "taken"
              ? "Already taken"
              : "Invalid slug"}
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function OnboardingPage(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [slug, setSlug] = useState("");
  const [debouncedSlug, setDebouncedSlug] = useState("");
  const [headline, setHeadline] = useState("");
  const [topicStrip, setTopicStrip] = useState("");
  const [subtagline, setSubtagline] = useState("");
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [rankingPrompt, setRankingPrompt] = useState("");
  const [shortlistPrompt, setShortlistPrompt] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: getOnboarding,
  });

  // Populate fields from existing state on load
  useEffect(() => {
    if (data) {
      setName(data.name);
      setSlug(data.slug);
      setHeadline(data.headline ?? "");
      setTopicStrip(data.topicStrip ?? "");
      setSubtagline(data.subtagline ?? "");
      // Find the furthest completed step
      if (data.onboardingState) {
        const state = data.onboardingState;
        const furthestIndex = STEPS.findLastIndex((s) => state[s.id]);
        if (furthestIndex >= 0) {
          setStep(Math.min(furthestIndex + 1, STEPS.length - 1));
        }
      }
    }
  }, [data]);

  // Debounce slug
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSlug(slug); }, 400);
    return () => { clearTimeout(timer); };
  }, [slug]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchOnboarding(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });

  const markStepDone = useCallback(
    (stepId: string) => {
      const currentState: OnboardingState = data?.onboardingState ?? {};
      saveMutation.mutate({ onboardingState: { ...currentState, [stepId]: true } });
    },
    [data?.onboardingState, saveMutation],
  );

  const handleNext = () => {
    markStepDone(STEPS[step].id);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleGeneratePrompts = async () => {
    setGenerating(true);
    try {
      const result = await generatePrompts(blurb);
      setRankingPrompt(result.ranking);
      setShortlistPrompt(result.shortlist);
    } catch {
      // silently fail
    } finally {
      setGenerating(false);
    }
  };

  const handleDiscoverSources = async () => {
    setDiscovering(true);
    try {
      const result = await discoverSources(blurb || "AI newsletter");
      setCandidates(result.candidates);
    } catch {
      // silently fail
    } finally {
      setDiscovering(false);
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    setActivateError(null);
    try {
      await activateTenant();
      void queryClient.invalidateQueries();
      void navigate("/admin");
    } catch (err) {
      try {
        const parsed = JSON.parse(
          err instanceof Error ? err.message : "",
        ) as { error: string; missing: string[] };
        setActivateError(`${parsed.error}: ${parsed.missing.join(", ")}`);
      } catch {
        setActivateError("Failed to activate. Try again.");
      }
    } finally {
      setActivating(false);
    }
  };

  const saveField = (field: string, value: string) => {
    saveMutation.mutate({ [field]: value || null });
  };

  const isComplete = data?.onboardingState
    ? ["name", "slug", "branding", "prompts", "sources", "schedule"].every(
        (s) => data.onboardingState?.[s as keyof OnboardingState],
      )
    : false;

  if (data?.status === "active") {
    // Already active — redirect to dashboard
    void navigate("/admin", { replace: true });
    return <div className="p-8 text-center">Redirecting...</div>;
  }

  const renderStepPanel = (): ReactElement => {
    switch (step) {
      case 0: // Name & slug
        return (
          <div className="step-panel active">
            <h2>Name your newsletter</h2>
            <p className="blurb">
              Pick a name and a URL slug. This will appear everywhere — your
              public site, emails, and social posts.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Newsletter name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); }}
                  onBlur={() => { saveField("name", name); }}
                  className="w-full border border-line rounded-md px-3 py-2 text-sm"
                  placeholder="My AI Digest"
                />
              </div>
              <SlugField
                slug={slug}
                setSlug={setSlug}
                debouncedSlug={debouncedSlug}
              />
            </div>
          </div>
        );

      case 1: // Slug (already covered in step 0, this is a review step)
        return (
          <div className="step-panel active">
            <h2>Your slug</h2>
            <p className="blurb">
              Your newsletter will live at <b>{slug || "..."}.vertexcover.io</b>.
              Make sure it&apos;s correct — this is permanent.
            </p>
          </div>
        );

      case 2: // Homepage text
        return (
          <div className="step-panel active">
            <h2>Homepage text</h2>
            <p className="blurb">
              Write your headline, topic strip, and optional subtagline.
              These appear on your public homepage.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Headline</label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => { setHeadline(e.target.value); }}
                  onBlur={() => { saveField("headline", headline); }}
                  className="w-full border border-line rounded-md px-3 py-2 text-sm"
                  placeholder="The daily read for people who ship with agents."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Topic strip</label>
                <input
                  type="text"
                  value={topicStrip}
                  onChange={(e) => { setTopicStrip(e.target.value); }}
                  onBlur={() => { saveField("topicStrip", topicStrip); }}
                  className="w-full border border-line rounded-md px-3 py-2 text-sm"
                  placeholder="AI · Agents · Tools · Research"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Subtagline</label>
                <input
                  type="text"
                  value={subtagline}
                  onChange={(e) => { setSubtagline(e.target.value); }}
                  onBlur={() => { saveField("subtagline", subtagline); }}
                  className="w-full border border-line rounded-md px-3 py-2 text-sm"
                  placeholder="One edition every morning. 5 minutes."
                />
              </div>
            </div>
          </div>
        );

      case 3: // Prompts
        return (
          <div className="step-panel active">
            <h2>Prompts</h2>
            <p className="blurb">
              Describe what your newsletter covers. We&apos;ll generate ranking
              and shortlist prompts tuned to your topic.
            </p>
            <div className="space-y-4">
              <textarea
                value={blurb}
                onChange={(e) => { setBlurb(e.target.value); }}
                className="w-full border border-line rounded-md px-3 py-2 text-sm h-28"
                placeholder="E.g. We cover AI agents, LLM tooling, and MCP servers for developers building with AI."
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { void handleGeneratePrompts(); }}
                disabled={generating || blurb.length < 10}
                type="button"
              >
                {generating ? "Generating..." : "Generate prompts"}
              </button>
              {rankingPrompt && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-mute mb-1">Ranking prompt</label>
                    <textarea
                      value={rankingPrompt}
                      onChange={(e) => { setRankingPrompt(e.target.value); }}
                      className="w-full border border-line rounded-md px-3 py-2 text-xs font-mono h-20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-mute mb-1">Shortlist prompt</label>
                    <textarea
                      value={shortlistPrompt}
                      onChange={(e) => { setShortlistPrompt(e.target.value); }}
                      className="w-full border border-line rounded-md px-3 py-2 text-xs font-mono h-20"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 4: // Sources
        return (
          <div className="step-panel active">
            <h2>Sources</h2>
            <p className="blurb">
              Discover sources for your newsletter. We use AI to find RSS feeds,
              blogs, and news sites that cover your topic.
            </p>
            <div className="space-y-4">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { void handleDiscoverSources(); }}
                disabled={discovering}
                type="button"
              >
                {discovering ? "Discovering..." : "Discover sources"}
              </button>
              {candidates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-mute">
                    Found {candidates.length} candidate sources. Click to add:
                  </p>
                  {candidates.map((c) => (
                    <div
                      key={c}
                      className="px-3 py-2 border border-line rounded-md text-sm font-mono cursor-pointer hover:bg-chip"
                      role="button"
                      tabIndex={0}
                      onClick={() => { setCandidates(candidates.filter((x) => x !== c)); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setCandidates(candidates.filter((x) => x !== c));
                        }
                      }}
                    >
                      {c}
                    </div>
                  ))}
                </div>
              )}
              {candidates.length === 0 && !discovering && (
                <p className="text-xs text-mute">
                  Click &quot;Discover sources&quot; to find sources, or add them manually later in Settings.
                </p>
              )}
            </div>
          </div>
        );

      case 5: // Schedule
        return (
          <div className="step-panel active">
            <h2>Schedule</h2>
            <p className="blurb">
              Set when your newsletter pipeline runs each day. You can adjust
              this later in Settings.
            </p>
            <div className="space-y-4">
              <p className="text-sm text-mute">
                The default schedule runs at <b>06:00 UTC</b> daily with email
                delivery at <b>06:30 UTC</b>. You&apos;ll be able to customize
                this in Settings after activation.
              </p>
            </div>
          </div>
        );

      case 6: // Social
        return (
          <div className="step-panel active">
            <h2>Social accounts</h2>
            <p className="blurb">
              Connect your Twitter and LinkedIn accounts to auto-post your
              digest. Optional — you can skip this and add them later.
            </p>
            <p className="text-sm text-mute">
              You can configure LinkedIn OAuth and Twitter in Settings after activation.
            </p>
          </div>
        );

      case 7: // Email
        return (
          <div className="step-panel active">
            <h2>Email delivery</h2>
            <p className="blurb">
              To send your digest to subscribers, you&apos;ll need to verify a
              sending domain. This can be done in Settings after activation.
            </p>
            <div className="space-y-4">
              <div className="p-4 border border-line rounded-lg bg-cream">
                <p className="text-sm text-mute">
                  You can start without a sending domain. Your public site will
                  be live, but email broadcast will be blocked until a domain
                  is verified.
                </p>
              </div>
            </div>
          </div>
        );

      default:
        return <div />;
    }
  };

  const progressPercent = ((step + 1) / STEPS.length) * 100;

  return (
    <div>
      <div className="wiz-top">
        <div className="row" style={{ gap: "9px" }}>
          <svg
            className="brandmark"
            width="22"
            height="22"
            viewBox="0 0 100 100"
            fill="none"
          >
            <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="5" />
            <circle cx="50" cy="50" r="12" fill="currentColor" />
          </svg>
          <span className="brand wordmark text-[15px]">AGENTLOOP</span>
        </div>
        <div className="mid">
          Setup &middot; step <b>{step + 1}</b> of {STEPS.length}
        </div>
        <a className="btn btn-ghost btn-sm" href="/admin">
          Save &amp; exit
        </a>
      </div>
      <div className="progress">
        <i style={{ width: `${String(progressPercent)}%` }} />
      </div>

      <div className="wiz">
        {/* Step rail */}
        <nav className="rail">
          <ol>
            {STEPS.map((s, i) => {
              const done = data?.onboardingState?.[s.id];
              const isActive = i === step;
              return (
                <li
                  key={s.id}
                  className={[
                    isActive ? "active" : "",
                    done ? "done" : "",
                  ].join(" ")}
                  onClick={() => { setStep(i); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setStep(i);
                  }}
                >
                  <div className="num">{done ? "✓" : i + 1}</div>
                  <div>
                    <div className="nm">{s.label}</div>
                    {s.required && <div className="req-tag">required</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Form column */}
        <div className="form-col">{renderStepPanel()}</div>

        {/* Preview pane */}
        <PreviewPane
          name={name}
          slug={slug}
          headline={headline}
          topicStrip={topicStrip}
          subtagline={subtagline}
        />
      </div>

      {/* Actions */}
      <div className="wiz-actions" style={{ paddingLeft: "44px" }}>
        <div>
          {step > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handlePrev}
              type="button"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {step === STEPS.length - 1 ? (
            <div className="flex items-center gap-3">
              {activateError && (
                <span className="text-xs text-danger">{activateError}</span>
              )}
              <button
                className="btn btn-primary"
                onClick={() => { void handleActivate(); }}
                disabled={activating || !isComplete}
                type="button"
              >
                {activating ? "Activating..." : "Activate"}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleNext}
              type="button"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

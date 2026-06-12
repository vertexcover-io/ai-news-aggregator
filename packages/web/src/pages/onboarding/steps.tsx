import {
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkSlug as defaultCheckSlug,
  createAdminSource,
  deleteAdminSource,
  discoverSources,
  getSendingDomain,
  getTwitterOAuthStatus,
  listAdminSources,
  registerSendingDomain,
  startTwitterOAuth,
  uploadLogo,
  verifySendingDomain,
  OnboardingApiError,
  type AdminSource,
  type OnboardingStepId,
  type SlugCheckStatus,
  type SourceCandidate,
} from "@/api/onboarding";
import {
  fetchLinkedInOAuthStatus,
  startLinkedInOAuth,
} from "@/api/socialCredentials";
import {
  errClass,
  helpClass,
  inputClass,
  inputInvalidClass,
  kickerClass,
  labelClass,
} from "@/pages/authShared";

export interface WizardFormValues {
  name: string;
  slug: string;
  headline: string;
  topicStrip: string;
  subtagline: string;
  description: string;
  rankingPrompt: string;
  shortlistPrompt: string;
  pipelineTime: string;
  emailTime: string;
  timezone: string;
}

type WizardForm = UseFormReturn<WizardFormValues>;

const continueBtn =
  "min-h-[42px] rounded-md bg-[#8c3a1e] px-5 text-[14px] font-medium text-[#fbfaf7] transition-colors hover:bg-[#6e2d17] disabled:opacity-50";
const outlineBtn =
  "min-h-[42px] rounded-md border border-[#d4ceba] bg-white px-4 text-[14px] text-[#14110d] transition-colors hover:border-[#8c3a1e] disabled:opacity-50";
const ghostBtn =
  "min-h-[42px] rounded-md px-4 text-[14px] text-[#6b6557] transition-colors hover:text-[#14110d]";
const pillBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-[#d4ceba] bg-white px-3 py-1.5 font-mono text-[12px] text-[#14110d] transition-colors hover:border-[#8c3a1e]";

export function StepShell({
  index,
  title,
  blurb,
  children,
  actions,
}: {
  index: number;
  title: string;
  blurb: string;
  children: ReactNode;
  actions: ReactNode;
}): ReactElement {
  return (
    <div className="max-w-[480px]">
      <p className={kickerClass}>Step {String(index + 1).padStart(2, "0")}</p>
      <h2 className="mb-2 mt-1.5 font-serif text-[30px] font-medium tracking-[-0.014em]">
        {title}
      </h2>
      <p className="mb-6 text-[14px] leading-relaxed text-[#6b6557]">{blurb}</p>
      {children}
      <div className="mt-8 flex items-center justify-between border-t border-[#e7e2d6] pt-5">
        {actions}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="mb-4">
      <label className={labelClass} htmlFor={id}>
        {label}
        {optional ? <span className="text-[#8a8472]"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className={errClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Step 1: name ─────────────────────────────────────────────────────────────

export function NameStep({
  form,
  busy,
  onContinue,
}: {
  form: WizardForm;
  busy: boolean;
  onContinue: () => void;
}): ReactElement {
  const { register, formState } = form;
  return (
    <StepShell
      index={0}
      title="Name your newsletter"
      blurb="This is the publication name readers see in the masthead and in their inbox."
      actions={
        <>
          <span />
          <button type="button" className={continueBtn} disabled={busy} onClick={onContinue}>
            Continue →
          </button>
        </>
      }
    >
      <Field id="name" label="Newsletter name" error={formState.errors.name?.message}>
        <input
          id="name"
          className={`${inputClass}${formState.errors.name ? ` ${inputInvalidClass}` : ""}`}
          placeholder="The Inference"
          {...register("name")}
        />
      </Field>
    </StepShell>
  );
}

// ── Step 2: slug ─────────────────────────────────────────────────────────────

export const SLUG_CHECK_DEBOUNCE_MS = 300;

type SlugUiStatus = SlugCheckStatus | "checking" | "idle";

const SLUG_STATUS_TEXT: Record<Exclude<SlugUiStatus, "idle">, (slug: string) => string> = {
  checking: () => "Checking availability…",
  available: (slug) => `${slug}.ourdomain.com is available`,
  taken: (slug) => `${slug}.ourdomain.com is already taken`,
  invalid: () => "Lowercase letters, numbers, and hyphens — 3 to 30 characters.",
  reserved: () => "That name is reserved. Pick another.",
};

export function SlugStep({
  form,
  busy,
  currentSlug,
  onBack,
  onContinue,
  checkSlugFn = defaultCheckSlug,
}: {
  form: WizardForm;
  busy: boolean;
  /** The tenant's already-claimed real slug ("" when still a placeholder). */
  currentSlug: string;
  onBack: () => void;
  onContinue: () => void;
  /** Test seam for the debounced availability check. */
  checkSlugFn?: (slug: string) => Promise<SlugCheckStatus>;
}): ReactElement {
  const slug = useWatch({ control: form.control, name: "slug" });
  const value = slug.trim().toLowerCase();
  const isSelf = currentSlug !== "" && value === currentSlug;
  const [checked, setChecked] = useState<{
    slug: string;
    status: SlugCheckStatus;
  } | null>(null);

  useEffect(() => {
    if (value === "" || isSelf) return;
    const timer = setTimeout(() => {
      checkSlugFn(value)
        .then((status) => {
          setChecked({ slug: value, status });
        })
        .catch(() => {
          setChecked(null);
        });
    }, SLUG_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value, isSelf, checkSlugFn]);

  const status: SlugUiStatus =
    value === ""
      ? "idle"
      : isSelf
        ? "available"
        : checked?.slug === value
          ? checked.status
          : "checking";
  const ok = status === "available";
  return (
    <StepShell
      index={1}
      title="Pick your address"
      blurb="Choose a subdomain. Your public newsletter lives here. You can change it later (old links redirect)."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <button
            type="button"
            className={continueBtn}
            disabled={busy || !ok}
            onClick={onContinue}
          >
            Continue →
          </button>
        </>
      }
    >
      <Field id="slug" label="Subdomain">
        <div className="flex items-stretch">
          <input
            id="slug"
            className={`${inputClass} rounded-r-none`}
            placeholder="theinference"
            autoComplete="off"
            {...form.register("slug")}
          />
          <span className="flex items-center rounded-r-md border border-l-0 border-[#d4ceba] bg-[#f3efe6] px-3 font-mono text-[12.5px] text-[#6b6557]">
            .ourdomain.com
          </span>
        </div>
        {status !== "idle" ? (
          <p
            data-testid="slug-status"
            data-status={status}
            className={`mt-2 flex items-center gap-1.5 font-mono text-[12px] ${
              ok ? "text-[#2e6b3f]" : status === "checking" ? "text-[#6b6557]" : "text-[#9e2b1a]"
            }`}
          >
            {SLUG_STATUS_TEXT[status](value)}
          </p>
        ) : null}
        <p className={`mt-2 ${helpClass}`}>
          Lowercase letters, numbers, and hyphens. Reserved words like{" "}
          <code>app</code>, <code>admin</code>, <code>api</code> aren’t allowed.
        </p>
      </Field>
    </StepShell>
  );
}

// ── Step 3: logo ─────────────────────────────────────────────────────────────

export function LogoStep({
  busy,
  onBack,
  onDone,
  onUploaded,
}: {
  busy: boolean;
  onBack: () => void;
  /** Continue or Skip — the step is optional either way. */
  onDone: () => void;
  onUploaded: (logoVersion: number) => void;
}): ReactElement {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: uploadLogo,
    onSuccess: (result, file) => {
      onUploaded(result.logoVersion);
      setPreviewUrl(URL.createObjectURL(file));
    },
  });

  return (
    <StepShell
      index={2}
      title="Add your logo"
      blurb="Optional — appears in your masthead and emails. PNG, JPEG, SVG, or WebP up to 512 KB."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <span className="flex gap-2">
            <button type="button" className={ghostBtn} disabled={busy} onClick={onDone}>
              Skip
            </button>
            <button type="button" className={continueBtn} disabled={busy} onClick={onDone}>
              Continue →
            </button>
          </span>
        </>
      }
    >
      <label
        htmlFor="logo-file"
        className="block cursor-pointer rounded-xl border-[1.5px] border-dashed border-[#d4ceba] bg-[#fbfaf7] p-7 text-center transition-colors hover:border-[#8c3a1e]"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Uploaded logo" className="mx-auto h-16 w-16 object-contain" />
        ) : (
          <span aria-hidden className="text-[22px] text-[#8a8472]">
            ⬆
          </span>
        )}
        <p className="mb-0.5 mt-2 text-[14px] text-[#14110d]">
          Drop an image or <span className="text-[#8c3a1e]">browse</span>
        </p>
        <p className={helpClass}>Square works best (≥ 256×256). Max 512 KB.</p>
        <input
          id="logo-file"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
      </label>
      {upload.isPending ? <p className={`mt-2 ${helpClass}`}>Uploading…</p> : null}
      {upload.isError ? (
        <p role="alert" className={errClass}>
          {upload.error instanceof OnboardingApiError
            ? `Upload rejected (${upload.error.message}). Your previous logo is unchanged.`
            : "Upload failed. Try again."}
        </p>
      ) : null}
    </StepShell>
  );
}

// ── Step 4: homepage text ────────────────────────────────────────────────────

export function HomepageStep({
  form,
  busy,
  onBack,
  onContinue,
}: {
  form: WizardForm;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
}): ReactElement {
  const { register, formState } = form;
  return (
    <StepShell
      index={3}
      title="Your homepage text"
      blurb="These fill the hero on your public homepage. The layout is fixed — you’re just filling the slots."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <button type="button" className={continueBtn} disabled={busy} onClick={onContinue}>
            Continue →
          </button>
        </>
      }
    >
      <Field id="headline" label="Headline" error={formState.errors.headline?.message}>
        <textarea
          id="headline"
          rows={2}
          className={`${inputClass}${formState.errors.headline ? ` ${inputInvalidClass}` : ""}`}
          placeholder="The daily read for people building with inference."
          {...register("headline")}
        />
      </Field>
      <Field id="topicStrip" label="Topic strip" error={formState.errors.topicStrip?.message}>
        <input
          id="topicStrip"
          className={`${inputClass}${formState.errors.topicStrip ? ` ${inputInvalidClass}` : ""}`}
          placeholder="Serving · Quantization · Latency · Cost"
          {...register("topicStrip")}
        />
        <p className={`mt-1.5 ${helpClass}`}>Shown under the headline. Separate topics with “·”.</p>
      </Field>
      <Field id="subtagline" label="Subtagline" optional>
        <input
          id="subtagline"
          className={inputClass}
          placeholder="No funding rounds. No leaderboards. Just the runtime."
          {...register("subtagline")}
        />
      </Field>
    </StepShell>
  );
}

// ── Step 5: prompts ──────────────────────────────────────────────────────────

export function PromptsStep({
  form,
  busy,
  generating,
  generateError,
  onGenerate,
  onBack,
  onContinue,
}: {
  form: WizardForm;
  busy: boolean;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
  onBack: () => void;
  onContinue: () => void;
}): ReactElement {
  const { register, formState, control } = form;
  const rankingPrompt = useWatch({ control, name: "rankingPrompt" });
  const shortlistPrompt = useWatch({ control, name: "shortlistPrompt" });
  const hasPrompts = rankingPrompt.trim() !== "" || shortlistPrompt.trim() !== "";

  return (
    <StepShell
      index={4}
      title="Tune what gets picked"
      blurb="Describe your newsletter in a sentence or two. We’ll generate tailored ranking & shortlist prompts from it — you can edit them."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <button type="button" className={continueBtn} disabled={busy} onClick={onContinue}>
            Continue →
          </button>
        </>
      }
    >
      <Field id="description" label="What’s your newsletter about?">
        <textarea
          id="description"
          rows={3}
          className={inputClass}
          placeholder="e.g. Practical LLM inference — serving, quantization, latency, cost. For ML engineers shipping to prod."
          {...register("description")}
        />
      </Field>
      <button
        type="button"
        className={outlineBtn}
        disabled={generating}
        onClick={onGenerate}
      >
        {generating ? "Generating…" : "✦ Generate prompts"}
      </button>
      {generateError ? (
        <p role="alert" className={errClass}>
          {generateError}
        </p>
      ) : null}
      {hasPrompts ? (
        <div className="mt-5">
          <Field
            id="rankingPrompt"
            label="Ranking prompt (editable)"
            error={formState.errors.rankingPrompt?.message}
          >
            <textarea
              id="rankingPrompt"
              rows={6}
              className={`${inputClass} font-mono text-[12px] leading-relaxed`}
              {...register("rankingPrompt")}
            />
          </Field>
          <Field
            id="shortlistPrompt"
            label="Shortlist prompt (editable)"
            error={formState.errors.shortlistPrompt?.message}
          >
            <textarea
              id="shortlistPrompt"
              rows={5}
              className={`${inputClass} font-mono text-[12px] leading-relaxed`}
              {...register("shortlistPrompt")}
            />
          </Field>
        </div>
      ) : null}
    </StepShell>
  );
}

// ── Step 6: channels (all optional) ──────────────────────────────────────────

function ConnectRow({
  icon,
  iconBg,
  title,
  subtitle,
  connected,
  onConnect,
  connecting,
}: {
  icon: string;
  iconBg: string;
  title: string;
  subtitle: string;
  connected: boolean;
  onConnect: () => void;
  connecting: boolean;
}): ReactElement {
  return (
    <div className="mb-3 flex items-center justify-between rounded-xl border border-[#e7e2d6] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-lg font-mono text-[13px] font-semibold text-white"
          style={{ background: iconBg }}
        >
          {icon}
        </span>
        <span>
          <span className="block text-[14px] font-semibold">{title}</span>
          <span className={helpClass}>{subtitle}</span>
        </span>
      </div>
      {connected ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#2e6b3f]">
          Connected
        </span>
      ) : (
        <button
          type="button"
          className={`${outlineBtn} min-h-[36px] text-[13px]`}
          disabled={connecting}
          onClick={onConnect}
        >
          Connect
        </button>
      )}
    </div>
  );
}

export function ChannelsStep({
  busy,
  onBack,
  onDone,
}: {
  busy: boolean;
  onBack: () => void;
  onDone: () => void;
}): ReactElement {
  const linkedin = useQuery({
    queryKey: ["linkedin-oauth-status"],
    queryFn: fetchLinkedInOAuthStatus,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const twitter = useQuery({
    queryKey: ["twitter-oauth-status"],
    queryFn: getTwitterOAuthStatus,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const domain = useQuery({
    queryKey: ["sending-domain"],
    queryFn: getSendingDomain,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const queryClient = useQueryClient();
  const [domainInput, setDomainInput] = useState("");

  const connectLinkedIn = useMutation({
    mutationFn: startLinkedInOAuth,
    onSuccess: ({ authorizeUrl }) => {
      window.location.assign(authorizeUrl);
    },
  });
  const connectTwitter = useMutation({
    mutationFn: startTwitterOAuth,
    onSuccess: ({ authorizeUrl }) => {
      window.location.assign(authorizeUrl);
    },
  });
  const register = useMutation({
    mutationFn: registerSendingDomain,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["sending-domain"] }),
  });
  const verify = useMutation({
    mutationFn: verifySendingDomain,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["sending-domain"] }),
  });

  const domainState = domain.data ?? null;

  return (
    <StepShell
      index={5}
      title="Connect channels"
      blurb="Optional — connect where you’ll publish. We never ask for app keys or secrets; you authorize via OAuth."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <span className="flex gap-2">
            <button type="button" className={ghostBtn} disabled={busy} onClick={onDone}>
              Skip
            </button>
            <button type="button" className={continueBtn} disabled={busy} onClick={onDone}>
              Continue →
            </button>
          </span>
        </>
      }
    >
      <ConnectRow
        icon="in"
        iconBg="#0a66c2"
        title="LinkedIn"
        subtitle="Post the digest to your page"
        connected={linkedin.data?.connected ?? false}
        connecting={connectLinkedIn.isPending}
        onConnect={() => {
          connectLinkedIn.mutate();
        }}
      />
      <ConnectRow
        icon="𝕏"
        iconBg="#111111"
        title="Twitter / X"
        subtitle="Authorize posting via OAuth"
        connected={twitter.data?.connected ?? false}
        connecting={connectTwitter.isPending}
        onConnect={() => {
          connectTwitter.mutate();
        }}
      />

      <div className="mt-5">
        <Field id="sending-domain" label="Sending domain (broadcast)">
          {domainState === null ? (
            <div className="flex gap-2">
              <input
                id="sending-domain"
                className={inputClass}
                placeholder="theinference.com"
                value={domainInput}
                onChange={(e) => {
                  setDomainInput(e.target.value);
                }}
              />
              <button
                type="button"
                className={outlineBtn}
                disabled={register.isPending || domainInput.trim() === ""}
                onClick={() => {
                  register.mutate(domainInput.trim().toLowerCase());
                }}
              >
                Register
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-[#e7e2d6] bg-[#fbfaf7] p-3">
              <p className="mb-1 flex items-center justify-between text-[13.5px]">
                <span className="font-mono">{domainState.domain}</span>
                <span
                  className={`font-mono text-[11px] uppercase tracking-[0.12em] ${
                    domainState.status === "verified" ? "text-[#2e6b3f]" : "text-[#6b6557]"
                  }`}
                >
                  {domainState.status}
                </span>
              </p>
              {domainState.status !== "verified" ? (
                <>
                  {domainState.dnsRecords.length > 0 ? (
                    <ul className="mb-2 max-h-28 overflow-auto font-mono text-[11px] leading-relaxed text-[#6b6557]">
                      {domainState.dnsRecords.map((r, idx) => (
                        <li key={`${r.name ?? ""}-${String(idx)}`}>
                          {r.type ?? r.record} {r.name} → {r.value}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    className={`${outlineBtn} min-h-[34px] text-[13px]`}
                    disabled={verify.isPending}
                    onClick={() => {
                      verify.mutate();
                    }}
                  >
                    {verify.isPending ? "Checking…" : "Verify DNS"}
                  </button>
                </>
              ) : null}
            </div>
          )}
          <p className={`mt-1.5 ${helpClass}`}>
            Until your domain verifies, confirmations send from our shared address
            and the broadcast stays paused.
          </p>
        </Field>
      </div>
    </StepShell>
  );
}

// ── Step 7: sources ──────────────────────────────────────────────────────────

function asLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function sourceLabel(source: AdminSource): string {
  if (source.type === "hn") return "Hacker News";
  if (source.type === "reddit") return `r/${asLabel(source.config.subreddit, "?")}`;
  if (source.type === "web") {
    return asLabel(source.config.name, asLabel(source.config.listingUrl, "Web"));
  }
  if (source.type === "web_search") {
    return `Search: ${asLabel(source.config.query, "?")}`;
  }
  return asLabel(source.config.handle, asLabel(source.config.listId, "Twitter"));
}

function candidateToCreateInput(candidate: SourceCandidate): {
  type: AdminSource["type"];
  config: Record<string, unknown>;
} | null {
  if (candidate.type === "reddit") {
    const match = /reddit\.com\/r\/([A-Za-z0-9_]+)/.exec(candidate.url) ??
      /^r\/([A-Za-z0-9_]+)/.exec(candidate.title.replace(/^\+?\s*/, ""));
    if (!match) return null;
    return { type: "reddit", config: { subreddit: match[1], sinceDays: 2 } };
  }
  if (candidate.type === "web") {
    return { type: "web", config: { name: candidate.title, listingUrl: candidate.url } };
  }
  return null;
}

function parseManualSource(raw: string): {
  type: AdminSource["type"];
  config: Record<string, unknown>;
} | null {
  const value = raw.trim();
  if (value === "") return null;
  const subreddit = /^r\/([A-Za-z0-9_]+)$/.exec(value) ??
    /reddit\.com\/r\/([A-Za-z0-9_]+)/.exec(value);
  if (subreddit) {
    return { type: "reddit", config: { subreddit: subreddit[1], sinceDays: 2 } };
  }
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return { type: "web", config: { name: url.hostname, listingUrl: url.toString() } };
  } catch {
    return null;
  }
}

export function SourcesStep({
  busy,
  defaultTopic,
  onBack,
  onContinue,
}: {
  busy: boolean;
  /** Pre-filled from the prompts-step description (REQ-037). */
  defaultTopic: string;
  onBack: () => void;
  onContinue: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: ["admin-sources"],
    queryFn: listAdminSources,
    refetchOnWindowFocus: false,
  });
  const [candidates, setCandidates] = useState<SourceCandidate[] | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["admin-sources"] });
  };
  const add = useMutation({ mutationFn: createAdminSource, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteAdminSource, onSuccess: invalidate });
  const discover = useMutation({
    mutationFn: discoverSources,
    onSuccess: setCandidates,
  });

  const rows = sources.data ?? [];
  const hasHn = rows.some((s) => s.type === "hn");

  return (
    <StepShell
      index={6}
      title="Choose your sources"
      blurb="Suggestions from your description (LLM + Tavily). Click to add — or add your own. You need at least one."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <button type="button" className={continueBtn} disabled={busy} onClick={onContinue}>
            Continue →
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {!hasHn ? (
          <button
            type="button"
            className={pillBtn}
            disabled={add.isPending}
            onClick={() => {
              add.mutate({ type: "hn", config: { sinceDays: 2 } });
            }}
          >
            <span className="text-[#8c3a1e]">+</span> Hacker News
          </button>
        ) : null}
        <button
          type="button"
          className={pillBtn}
          disabled={discover.isPending || defaultTopic.trim().length < 2}
          onClick={() => {
            discover.mutate(defaultTopic.trim());
          }}
        >
          {discover.isPending ? "Searching…" : "✦ Suggest sources"}
        </button>
      </div>
      {discover.isError ? (
        <p className={`mb-3 ${helpClass}`}>
          {discover.error instanceof OnboardingApiError && discover.error.status === 503
            ? "Source discovery isn’t configured on this deployment — add sources manually."
            : "Discovery failed. Try again or add sources manually."}
        </p>
      ) : null}
      {candidates !== null ? (
        <div className="mb-4">
          <p className={labelClass}>Suggested for you</p>
          {candidates.length === 0 ? (
            <p className={helpClass}>No suggestions found — add sources manually below.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {candidates.map((candidate) => {
                const input = candidateToCreateInput(candidate);
                if (!input) return null;
                return (
                  <button
                    key={candidate.url}
                    type="button"
                    className={pillBtn}
                    disabled={add.isPending}
                    onClick={() => {
                      add.mutate(input);
                      setCandidates((prev) =>
                        prev ? prev.filter((c) => c.url !== candidate.url) : prev,
                      );
                    }}
                  >
                    <span className="text-[#8c3a1e]">+</span> {candidate.title}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <hr className="my-4 border-[#e7e2d6]" />
      <p className={labelClass}>
        Selected · {String(rows.length)} {rows.length === 1 ? "source" : "sources"}
      </p>
      {rows.length === 0 ? (
        <p className={`mb-3 ${helpClass}`}>Nothing yet — you need at least one source to activate.</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {rows.map((source) => (
            <span
              key={source.id}
              className="inline-flex items-center gap-2 rounded-full bg-[#14110d] px-3 py-1.5 font-mono text-[12px] text-[#fbfaf7]"
            >
              {sourceLabel(source)}
              <button
                type="button"
                aria-label={`Remove ${sourceLabel(source)}`}
                className="text-[#fbfaf7]/70 hover:text-white"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(source.id);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <Field id="manual-source" label="Add manually" error={manualError ?? undefined}>
        <div className="flex gap-2">
          <input
            id="manual-source"
            className={inputClass}
            placeholder="Paste a blog/listing URL or a subreddit like r/LocalLLaMA"
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
            }}
          />
          <button
            type="button"
            className={outlineBtn}
            disabled={add.isPending || manual.trim() === ""}
            onClick={() => {
              const input = parseManualSource(manual);
              if (!input) {
                setManualError("Enter a URL or a subreddit like r/LocalLLaMA.");
                return;
              }
              setManualError(null);
              add.mutate(input);
              setManual("");
            }}
          >
            Add
          </button>
        </div>
      </Field>
    </StepShell>
  );
}

// ── Step 8: schedule + activate ──────────────────────────────────────────────

export const TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export const STEP_TITLES: Record<OnboardingStepId, string> = {
  name: "Newsletter name",
  slug: "Subdomain",
  logo: "Logo",
  homepage: "Homepage text",
  prompts: "Prompts",
  channels: "Social & email",
  sources: "Sources",
  schedule: "Schedule",
};

export function ScheduleStep({
  form,
  slug,
  activating,
  missing,
  onBack,
  onActivate,
  onGoToStep,
}: {
  form: WizardForm;
  slug: string;
  activating: boolean;
  /** Steps the API reported missing on the last activation attempt (REQ-038). */
  missing: OnboardingStepId[];
  onBack: () => void;
  onActivate: () => void;
  onGoToStep: (step: OnboardingStepId) => void;
}): ReactElement {
  const { register, formState } = form;
  const tzOptions = TIMEZONE_OPTIONS.includes(form.getValues("timezone"))
    ? TIMEZONE_OPTIONS
    : [form.getValues("timezone"), ...TIMEZONE_OPTIONS];
  return (
    <StepShell
      index={7}
      title="Set your schedule"
      blurb="When the pipeline runs and when the digest sends. We jitter start times slightly to spread load."
      actions={
        <>
          <button type="button" className={outlineBtn} onClick={onBack}>
            ← Back
          </button>
          <button
            type="button"
            className={continueBtn}
            disabled={activating}
            onClick={onActivate}
          >
            {activating ? "Activating…" : "Activate newsletter ✦"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id="pipelineTime" label="Pipeline run" error={formState.errors.pipelineTime?.message}>
          <input id="pipelineTime" type="time" className={inputClass} {...register("pipelineTime")} />
        </Field>
        <Field id="emailTime" label="Email send" error={formState.errors.emailTime?.message}>
          <input id="emailTime" type="time" className={inputClass} {...register("emailTime")} />
        </Field>
      </div>
      <Field id="timezone" label="Timezone" error={formState.errors.timezone?.message}>
        <select id="timezone" className={inputClass} {...register("timezone")}>
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>

      {missing.length > 0 ? (
        <div
          role="alert"
          data-testid="activate-missing"
          className="mt-4 rounded-md border border-[#e2b9a8] bg-[#faf1ec] p-3.5"
        >
          <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#9e2b1a]">
            Finish these required steps first
          </p>
          <ul className="space-y-1">
            {missing.map((step) => (
              <li key={step}>
                <button
                  type="button"
                  className="text-[13.5px] text-[#8c3a1e] underline decoration-dotted underline-offset-2 hover:text-[#14110d]"
                  onClick={() => {
                    onGoToStep(step);
                  }}
                >
                  {STEP_TITLES[step]} →
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={`mt-3 ${helpClass}`}>
          Activating makes <b>{slug || "your-slug"}.ourdomain.com</b> live and starts
          your daily runs.
        </p>
      )}
    </StepShell>
  );
}

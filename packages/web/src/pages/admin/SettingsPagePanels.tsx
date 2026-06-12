import { useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchLinkedInOAuthStatus,
  startLinkedInOAuth,
} from "../../api/socialCredentials";
import { useSession } from "../../hooks/useSession";
import {
  disconnectTwitter,
  fetchTwitterOAuthStatus,
  getSendingDomain,
  putBranding,
  registerSendingDomain,
  startTwitterOAuth,
  uploadLogo,
  verifySendingDomain,
  type BrandingUpdate,
} from "./SettingsPageApi";

export function SettingsPanel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      id={id}
      aria-label={title}
      className="rounded-lg border bg-white p-4 sm:p-6 space-y-4 scroll-mt-20"
    >
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

const inputClass =
  "w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";

// ── Branding ─────────────────────────────────────────────────────────────────

export function BrandingPanel(): ReactElement {
  const { tenant } = useSession();
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [subtagline, setSubtagline] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const patch: BrandingUpdate = {
        ...(name.trim() !== "" ? { name: name.trim() } : {}),
        ...(headline.trim() !== "" ? { headline: headline.trim() } : {}),
        ...(subtagline.trim() !== "" ? { subtagline: subtagline.trim() } : {}),
      };
      if (Object.keys(patch).length > 0) await putBranding(patch);
      if (logoFile) await uploadLogo(logoFile);
    },
    onSuccess: () => {
      toast.success("Branding saved");
      setLogoFile(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save branding");
    },
  });

  return (
    <SettingsPanel
      id="branding"
      title="Branding"
      description="Shown on your public site and in emails."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Newsletter name</span>
          <input
            className={`${inputClass} mt-1`}
            value={name}
            placeholder={tenant?.name ?? "Newsletter name"}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Logo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="mt-1 block w-full text-sm"
            onChange={(e) => {
              setLogoFile(e.target.files?.[0] ?? null);
            }}
          />
          <span className="text-xs text-muted-foreground">
            PNG · JPEG · SVG · WebP · ≤ 512 KB
          </span>
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium">Headline</span>
        <input
          className={`${inputClass} mt-1`}
          value={headline}
          placeholder="The daily read for people building with *inference.*"
          onChange={(e) => {
            setHeadline(e.target.value);
          }}
        />
        <span className="text-xs text-muted-foreground">
          Wrap a phrase in *asterisks* to accent it.
        </span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Subtagline</span>
        <input
          className={`${inputClass} mt-1`}
          value={subtagline}
          onChange={(e) => {
            setSubtagline(e.target.value);
          }}
        />
      </label>
      {tenant && (
        <p className="text-xs text-muted-foreground">
          Subdomain: <span className="font-mono">{tenant.slug}</span>
        </p>
      )}
      <button
        type="button"
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 min-h-[40px]"
        disabled={saveMutation.isPending}
        onClick={() => {
          saveMutation.mutate();
        }}
      >
        Save branding
      </button>
    </SettingsPanel>
  );
}

// ── Social posting (OAuth, REQ-080) ──────────────────────────────────────────

export function SocialPanel(): ReactElement {
  const linkedin = useQuery({
    queryKey: ["linkedin-oauth-status"],
    queryFn: fetchLinkedInOAuthStatus,
    refetchOnWindowFocus: false,
  });
  const twitter = useQuery({
    queryKey: ["twitter-oauth-status"],
    queryFn: fetchTwitterOAuthStatus,
    refetchOnWindowFocus: false,
  });
  const queryClient = useQueryClient();

  async function connect(start: () => Promise<{ authorizeUrl: string }>): Promise<void> {
    try {
      const { authorizeUrl } = await start();
      window.location.assign(authorizeUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start OAuth");
    }
  }

  const disconnectMutation = useMutation({
    mutationFn: disconnectTwitter,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["twitter-oauth-status"] });
    },
    onError: () => {
      toast.error("Failed to disconnect Twitter");
    },
  });

  return (
    <SettingsPanel
      id="social"
      title="Social posting"
      description="Connect via OAuth — no API keys or secrets to manage."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
        <div className="text-sm">
          <div className="font-medium">LinkedIn</div>
          <div className="text-muted-foreground">
            {linkedin.data?.connected
              ? `Connected${linkedin.data.connectedAs ? ` as ${linkedin.data.connectedAs}` : ""}`
              : "Authorize posting via OAuth"}
          </div>
        </div>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 min-h-[36px]"
          disabled={linkedin.data?.clientConfigured === false}
          onClick={() => {
            void connect(startLinkedInOAuth);
          }}
        >
          {linkedin.data?.connected ? "Reconnect LinkedIn" : "Connect LinkedIn"}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
        <div className="text-sm">
          <div className="font-medium">Twitter / X</div>
          <div className="text-muted-foreground">
            {twitter.data?.connected
              ? `Connected${twitter.data.connectedAs ? ` as ${twitter.data.connectedAs}` : ""}`
              : "Authorize posting via OAuth"}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 min-h-[36px]"
            disabled={twitter.data?.clientConfigured === false}
            onClick={() => {
              void connect(startTwitterOAuth);
            }}
          >
            {twitter.data?.connected ? "Reconnect with X" : "Connect with X"}
          </button>
          {twitter.data?.connected && (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 min-h-[36px]"
              disabled={disconnectMutation.isPending}
              onClick={() => {
                disconnectMutation.mutate();
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The Twitter collector that scrapes content is shared and managed by us
        — it needs nothing from you.
      </p>
    </SettingsPanel>
  );
}

// ── Sending domain (REQ-084/085) ─────────────────────────────────────────────

const DOMAIN_STATUS_STYLE: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

export function SendingDomainPanel(): ReactElement {
  const queryClient = useQueryClient();
  const domainQuery = useQuery({
    queryKey: ["sending-domain"],
    queryFn: getSendingDomain,
    refetchOnWindowFocus: false,
  });
  const [domainInput, setDomainInput] = useState("");

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["sending-domain"] });
  };

  const registerMutation = useMutation({
    mutationFn: registerSendingDomain,
    onSuccess: refresh,
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to register domain");
    },
  });
  const verifyMutation = useMutation({
    mutationFn: verifySendingDomain,
    onSuccess: refresh,
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to verify domain");
    },
  });

  const domain = domainQuery.data ?? null;

  return (
    <SettingsPanel
      id="sending-domain"
      title="Sending domain"
      description="Verify a domain to broadcast to your subscribers. Until then the broadcast is paused; confirmations still send from our shared address."
    >
      {domain === null ? (
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputClass} max-w-xs`}
            placeholder="news.yourdomain.com"
            value={domainInput}
            onChange={(e) => {
              setDomainInput(e.target.value);
            }}
          />
          <button
            type="button"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 min-h-[40px]"
            disabled={registerMutation.isPending || domainInput.trim() === ""}
            onClick={() => {
              registerMutation.mutate(domainInput.trim().toLowerCase());
            }}
          >
            Register domain
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono">{domain.domain}</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DOMAIN_STATUS_STYLE[domain.status] ?? ""}`}
            >
              {domain.status === "verified"
                ? "Verified"
                : domain.status === "failed"
                  ? "Failed"
                  : "Pending"}
            </span>
          </div>
          {domain.dnsRecords.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b uppercase tracking-wider text-neutral-500">
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Value</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.dnsRecords.map((record) => (
                    <tr key={`${record.type}-${record.name}`} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-mono">{record.type}</td>
                      <td className="py-2 pr-3 font-mono">{record.name}</td>
                      <td className="max-w-[16rem] truncate py-2 pr-3 font-mono">
                        {record.value}
                      </td>
                      <td className="py-2">{record.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            DNS can take up to 48h to propagate.
          </p>
          <button
            type="button"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 min-h-[40px]"
            disabled={verifyMutation.isPending}
            onClick={() => {
              verifyMutation.mutate();
            }}
          >
            Verify domain
          </button>
        </div>
      )}
    </SettingsPanel>
  );
}

// ── Notifications (REQ-092) ──────────────────────────────────────────────────

export interface NotificationsValue {
  notificationEmail: string;
  /** Empty string = leave the stored webhook untouched. */
  slackWebhookUrl: string;
}

export function NotificationsPanel({
  value,
  hasSlackWebhook,
  onChange,
}: {
  value: NotificationsValue;
  hasSlackWebhook: boolean;
  onChange: (next: NotificationsValue) => void;
}): ReactElement {
  return (
    <SettingsPanel
      id="notifications"
      title="Notifications"
      description="Where we ping you when a run is ready to review or something fails."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Notification email</span>
          <input
            type="email"
            className={`${inputClass} mt-1`}
            value={value.notificationEmail}
            onChange={(e) => {
              onChange({ ...value, notificationEmail: e.target.value });
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Slack incoming webhook</span>
          <input
            type="url"
            className={`${inputClass} mt-1`}
            value={value.slackWebhookUrl}
            placeholder={
              hasSlackWebhook ? "Configured (••••hooks.slack.com)" : "https://hooks.slack.com/services/…"
            }
            onChange={(e) => {
              onChange({ ...value, slackWebhookUrl: e.target.value });
            }}
          />
          <span className="text-xs text-muted-foreground">
            {hasSlackWebhook
              ? "A webhook is configured — stored encrypted, never shown. Paste a new URL to replace it."
              : "Create an Incoming Webhook in your Slack workspace and paste the URL. Stored encrypted."}
          </span>
        </label>
      </div>
    </SettingsPanel>
  );
}

// ── Features (REQ-093) ───────────────────────────────────────────────────────

export interface FeaturesValue {
  canonEnabled: boolean;
  deliverabilityEnabled: boolean;
  evalEnabled: boolean;
}

const FEATURES: {
  key: keyof FeaturesValue;
  label: string;
  description: string;
}[] = [
  {
    key: "deliverabilityEnabled",
    label: "Deliverability analytics",
    description:
      "A dashboard of opens, bounces, complaints, and delivery events for your sends.",
  },
  {
    key: "canonEnabled",
    label: "Canon · “Must Read”",
    description:
      "Maintain a curated must-read list and show a Must Read page + nav link on your public site.",
  },
  {
    key: "evalEnabled",
    label: "Eval",
    description:
      "Offline ranking evaluation tools for tuning your prompts against graded fixtures.",
  },
];

export function FeaturesPanel({
  value,
  onChange,
}: {
  value: FeaturesValue;
  onChange: (next: FeaturesValue) => void;
}): ReactElement {
  return (
    <SettingsPanel
      id="features"
      title="Features"
      description="Optional capabilities, off by default. Turn on what you need."
    >
      <ul className="space-y-3">
        {FEATURES.map((feature) => (
          <li
            key={feature.key}
            className="flex items-start justify-between gap-4 rounded border p-3"
          >
            <div className="text-sm">
              <div className="font-medium">{feature.label}</div>
              <div className="text-muted-foreground">{feature.description}</div>
            </div>
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                aria-label={feature.label}
                checked={value[feature.key]}
                onChange={(e) => {
                  onChange({ ...value, [feature.key]: e.target.checked });
                }}
              />
              {value[feature.key] ? "On" : "Off"}
            </label>
          </li>
        ))}
      </ul>
    </SettingsPanel>
  );
}

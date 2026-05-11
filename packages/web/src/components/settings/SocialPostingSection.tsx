import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getSocialStatus,
  startSocialTestPost,
  getSocialTestPostResult,
  type SocialPlatform,
  type SocialStatus,
} from "../../api/socialTestPost";

type RowState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "posted"; permalink?: string }
  | { state: "failed"; error?: string }
  | { state: "timeout" };

interface PlatformRowProps {
  platform: SocialPlatform;
  label: string;
  configured: boolean;
  rowState: RowState;
  onSendTest: () => void;
}

function permalinkHref(permalink: string): string | null {
  if (permalink.startsWith("urn:li:share:")) {
    return `https://www.linkedin.com/feed/update/${permalink}`;
  }
  if (permalink.startsWith("https://x.com/")) {
    return permalink;
  }
  return null;
}

function PlatformRow({
  platform,
  label,
  configured,
  rowState,
  onSendTest,
}: PlatformRowProps): ReactElement {
  return (
    <div
      className="rounded-md border bg-background p-4"
      data-testid={`social-row-${platform}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-medium">{label}</span>
          {configured ? (
            <span
              className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
              data-testid={`social-pill-${platform}`}
            >
              Connected
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
              data-testid={`social-pill-${platform}`}
            >
              Not configured
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!configured || rowState.state === "pending"}
          onClick={onSendTest}
        >
          {rowState.state === "pending" ? "Sending…" : "Send test post"}
        </Button>
      </div>
      {!configured && (
        <details className="mt-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer">Setup instructions</summary>
          <p className="mt-1">
            Run <code>pnpm tsx scripts/auth-{platform}.ts</code> once to grant
            access.
          </p>
        </details>
      )}
      <div
        className="mt-2 text-sm"
        data-testid={`social-result-${platform}`}
      >
        {rowState.state === "pending" && (
          <span className="text-muted-foreground">Posting…</span>
        )}
        {rowState.state === "posted" && (
          <span>
            Posted
            {rowState.permalink &&
              (() => {
                const href = permalinkHref(rowState.permalink);
                if (!href) {
                  return (
                    <span className="ml-1 text-muted-foreground">
                      ({rowState.permalink})
                    </span>
                  );
                }
                return (
                  <>
                    {" — "}
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline"
                    >
                      view post
                    </a>
                  </>
                );
              })()}
          </span>
        )}
        {rowState.state === "failed" && (
          <span className="text-red-600">
            Failed: {rowState.error ?? "unknown error"}
          </span>
        )}
        {rowState.state === "timeout" && (
          <span className="text-red-600">Timed out</span>
        )}
      </div>
    </div>
  );
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

export interface SocialPostingSectionProps {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export function SocialPostingSection({
  pollIntervalMs = POLL_INTERVAL_MS,
  pollTimeoutMs = POLL_TIMEOUT_MS,
}: SocialPostingSectionProps = {}): ReactElement {
  const statusQuery = useQuery<SocialStatus>({
    queryKey: ["social-status"],
    queryFn: getSocialStatus,
    refetchOnWindowFocus: false,
  });

  const [rows, setRows] = useState<Record<SocialPlatform, RowState>>({
    linkedin: { state: "idle" },
    twitter: { state: "idle" },
  });

  function setRowState(platform: SocialPlatform, next: RowState): void {
    setRows((prev) => ({ ...prev, [platform]: next }));
  }

  async function handleSendTest(platform: SocialPlatform): Promise<void> {
    setRowState(platform, { state: "pending" });
    try {
      const { requestId } = await startSocialTestPost(platform);
      const start = Date.now();
      while (Date.now() - start < pollTimeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const result = await getSocialTestPostResult(requestId);
        if (result.status === "posted") {
          setRowState(platform, {
            state: "posted",
            permalink: result.permalink,
          });
          return;
        }
        if (result.status === "failed") {
          setRowState(platform, { state: "failed", error: result.error });
          return;
        }
      }
      setRowState(platform, { state: "timeout" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "request failed";
      setRowState(platform, { state: "failed", error: msg });
    }
  }

  const linkedinConfigured = statusQuery.data?.linkedin.configured ?? false;
  const twitterConfigured = statusQuery.data?.twitter.configured ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Social posting</CardTitle>
        <CardDescription>
          Auto-posts after each newsletter send. Use the test buttons to verify
          your tokens work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <PlatformRow
          platform="linkedin"
          label="LinkedIn"
          configured={linkedinConfigured}
          rowState={rows.linkedin}
          onSendTest={() => {
            void handleSendTest("linkedin");
          }}
        />
        <PlatformRow
          platform="twitter"
          label="X (Twitter)"
          configured={twitterConfigured}
          rowState={rows.twitter}
          onSendTest={() => {
            void handleSendTest("twitter");
          }}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Email panel (Fix #3, Phase B): choose how this tenant sends its newsletter.
 *  - Managed (default)        → our shared verified domain, zero-config.
 *  - My own sending domain    → verify a domain below (SendingDomainPanel).
 *  - My own SMTP provider     → bring any ESP via SMTP creds.
 *
 * Secrets are write-only: the password is never returned (`passwordSet`), and
 * an empty password field on save keeps the stored one.
 */
import { useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmailMode } from "@newsletter/shared/types/tenant";
import {
  getEmailSettings,
  putEmailSettings,
  EmailSettingsApiError,
} from "../../api/emailSettings";

const QUERY_KEY = ["email-settings"] as const;

const MODE_LABEL: Record<EmailMode, string> = {
  managed: "Managed (recommended)",
  managed_domain: "My own sending domain",
  smtp: "My own SMTP provider",
};

interface SmtpForm {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

const EMPTY_SMTP: SmtpForm = {
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  fromAddress: "",
  fromName: "",
};

export function EmailPanel(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getEmailSettings });

  const [mode, setMode] = useState<EmailMode>("managed");
  const [smtp, setSmtp] = useState(EMPTY_SMTP);
  const [passwordSet, setPasswordSet] = useState(false);
  const [hydratedAt, setHydratedAt] = useState(0);
  // Hydrate the form from the server during render (the lint-clean pattern,
  // mirroring BrandingPanel) — but never clobber the operator's in-progress
  // edits once they've interacted.
  const [touched, setTouched] = useState(false);
  if (query.data && query.dataUpdatedAt !== hydratedAt && !touched) {
    setHydratedAt(query.dataUpdatedAt);
    setMode(query.data.mode);
    if (query.data.smtp) {
      const s = query.data.smtp;
      setSmtp({
        host: s.host,
        port: String(s.port),
        secure: s.secure,
        username: s.username,
        password: "",
        fromAddress: s.fromAddress,
        fromName: s.fromName ?? "",
      });
      setPasswordSet(s.passwordSet);
    }
  }

  const save = useMutation({
    mutationFn: putEmailSettings,
    onSuccess: (wire) => {
      queryClient.setQueryData(QUERY_KEY, wire);
      toast.success("Email settings saved");
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof EmailSettingsApiError ? err.message : "Failed to save email settings",
      );
    },
  });

  function onSave(): void {
    if (mode === "smtp") {
      save.mutate({
        mode,
        smtp: {
          host: smtp.host.trim(),
          port: Number(smtp.port),
          secure: smtp.secure,
          username: smtp.username.trim(),
          // Omit when blank so the stored password is kept.
          ...(smtp.password.length > 0 ? { password: smtp.password } : {}),
          fromAddress: smtp.fromAddress.trim(),
          ...(smtp.fromName.trim().length > 0 ? { fromName: smtp.fromName.trim() } : {}),
        },
      });
    } else {
      save.mutate({ mode });
    }
  }

  return (
    <Card data-testid="email-panel">
      <CardHeader>
        <CardTitle>Email sending</CardTitle>
        <CardDescription>
          How your newsletter is delivered. Current sender:{" "}
          <span data-testid="email-effective-sender" className="font-mono">
            {query.data?.effectiveSender ?? "…"}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {(Object.keys(MODE_LABEL) as EmailMode[]).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="email-mode"
                value={m}
                data-testid={`email-mode-${m}`}
                checked={mode === m}
                onChange={() => {
                  setTouched(true);
                  setMode(m);
                }}
              />
              {MODE_LABEL[m]}
            </label>
          ))}
        </div>

        {mode === "managed" ? (
          <p className="text-sm text-muted-foreground">
            Sends from our shared, already-verified domain — nothing to set up.
          </p>
        ) : null}

        {mode === "managed_domain" ? (
          <p className="text-sm text-muted-foreground">
            Register and verify your own sending domain in the “Sending domain”
            panel below; broadcasts pause until it’s verified.
          </p>
        ) : null}

        {mode === "smtp" ? (
          <div className="space-y-3" data-testid="email-smtp-form">
            <p className="text-xs text-muted-foreground">
              Point at a real email provider’s SMTP relay (SES, SendGrid,
              Postmark, Mailgun…), not a personal mailbox. You manage SPF/DKIM
              with your provider.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="smtp-host">Host</Label>
                <Input
                  id="smtp-host"
                  value={smtp.host}
                  onChange={(e) => { setSmtp({ ...smtp, host: e.target.value }); }}
                />
              </div>
              <div>
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  value={smtp.port}
                  onChange={(e) => { setSmtp({ ...smtp, port: e.target.value }); }}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="smtp-secure"
                checked={smtp.secure}
                onChange={(e) => { setSmtp({ ...smtp, secure: e.target.checked }); }}
              />
              Use implicit TLS (port 465)
            </label>
            <div>
              <Label htmlFor="smtp-username">Username</Label>
              <Input
                id="smtp-username"
                value={smtp.username}
                onChange={(e) => { setSmtp({ ...smtp, username: e.target.value }); }}
              />
            </div>
            <div>
              <Label htmlFor="smtp-password">
                Password {passwordSet ? "(leave blank to keep current)" : ""}
              </Label>
              <Input
                id="smtp-password"
                type="password"
                value={smtp.password}
                placeholder={passwordSet ? "••••••••" : ""}
                onChange={(e) => { setSmtp({ ...smtp, password: e.target.value }); }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="smtp-from">From address</Label>
                <Input
                  id="smtp-from"
                  value={smtp.fromAddress}
                  onChange={(e) => { setSmtp({ ...smtp, fromAddress: e.target.value }); }}
                />
              </div>
              <div>
                <Label htmlFor="smtp-from-name">From name (optional)</Label>
                <Input
                  id="smtp-from-name"
                  value={smtp.fromName}
                  onChange={(e) => { setSmtp({ ...smtp, fromName: e.target.value }); }}
                />
              </div>
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          size="sm"
          data-testid="email-save-btn"
          disabled={save.isPending}
          onClick={onSave}
        >
          {save.isPending ? "Saving…" : "Save email settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

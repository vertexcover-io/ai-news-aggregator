import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, CheckCircle, XCircle, Loader2, Globe, AlertTriangle } from "lucide-react";
import type { DnsRecord, DomainVerificationStatus } from "@newsletter/shared/types";

interface DomainInfo {
  domainId: string;
  domainName: string;
  status: DomainVerificationStatus;
  records: DnsRecord[];
  failureReasons?: string[];
}

async function fetchDomainStatus(): Promise<DomainInfo | null> {
  const res = await fetch("/api/settings/domain", {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json();
}

async function registerDomain(domainName: string): Promise<DomainInfo> {
  const res = await fetch("/api/settings/domain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: domainName }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Failed to register domain");
  }
  return res.json();
}

async function verifyDomain(): Promise<DomainInfo> {
  const res = await fetch("/api/settings/domain/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Failed to verify domain");
  }
  return res.json();
}

function StatusBadge({ status }: { status: DomainVerificationStatus }) {
  switch (status) {
    case "verified":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
          <CheckCircle className="size-3" />
          Verified
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          <Loader2 className="size-3 animate-spin" />
          Pending
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
          <XCircle className="size-3" />
          Failed
        </span>
      );
    case "none":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          <AlertTriangle className="size-3" />
          Not configured
        </span>
      );
  }
}

export function SendingDomainPanel(): React.ReactElement {
  const [domainName, setDomainName] = useState("");
  const queryClient = useQueryClient();

  const domainQuery = useQuery({
    queryKey: ["sending-domain"],
    queryFn: fetchDomainStatus,
  });

  const registerMutation = useMutation({
    mutationFn: registerDomain,
    onSuccess: (data) => {
      queryClient.setQueryData(["sending-domain"], data);
      toast.success("Domain registered successfully");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: verifyDomain,
    onSuccess: (data) => {
      queryClient.setQueryData(["sending-domain"], data);
      if (data.status === "verified") {
        toast.success("Domain verified");
      } else if (data.status === "failed") {
        toast.error("Domain verification failed. Check DNS records.");
      } else {
        toast("Verification in progress — DNS changes may take time to propagate");
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const domain = domainQuery.data;

  return (
    <section className="rounded-lg border bg-white p-6">
      <div className="flex items-center gap-2 mb-4">
        <Mail className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Sending Domain</h2>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Configure a verified sending domain for email delivery. Broadcasts are blocked until a domain is verified.
      </p>

      {!domain || domain.status === "none" ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              placeholder="newsletter.example.com"
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => registerMutation.mutate(domainName)}
              disabled={!domainName.trim() || registerMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {registerMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Globe className="size-4" />
              )}
              Register
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{domain.domainName}</span>
              <StatusBadge status={domain.status} />
            </div>
            <button
              type="button"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {verifyMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Verify
            </button>
          </div>

          {domain.status === "failed" && domain.failureReasons && domain.failureReasons.length > 0 && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium">Verification failed:</p>
              <ul className="list-disc list-inside mt-1">
                {domain.failureReasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {domain.records.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Value</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.records.map((rec, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {rec.type}
                        {rec.priority !== undefined ? ` (${rec.priority})` : ""}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{rec.name}</td>
                      <td className="py-2 pr-4 font-mono text-xs break-all max-w-[300px]">{rec.value}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                            rec.status === "verified"
                              ? "bg-green-100 text-green-800"
                              : rec.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {rec.status === "verified" ? (
                            <CheckCircle className="size-3" />
                          ) : rec.status === "failed" ? (
                            <XCircle className="size-3" />
                          ) : null}
                          {rec.status === "not_started" ? "pending" : rec.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

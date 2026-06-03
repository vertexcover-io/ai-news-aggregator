import type { ReactElement } from "react";
import { Loader2, Check, X } from "lucide-react";
import type { CollectorType } from "@newsletter/shared/types";
import { Button } from "@/components/ui/button";
import { useHealthCheck } from "../../hooks/useHealthCheck";

interface HealthCheckButtonProps {
  collector: CollectorType;
  label: string;
}

export function HealthCheckButton({
  collector,
  label,
}: HealthCheckButtonProps): ReactElement {
  const mutation = useHealthCheck(collector);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => {
        mutation.mutate();
      }}
      className="min-h-[44px]"
      aria-label={`Check health of ${label}`}
    >
      {mutation.isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking...
        </>
      ) : mutation.isSuccess ? (
        <>
          <Check className="h-4 w-4 text-emerald-600" />
          Healthy
        </>
      ) : mutation.isError ? (
        <>
          <X className="h-4 w-4 text-red-600" />
          {mutation.error.message}
        </>
      ) : (
        "Check Health"
      )}
    </Button>
  );
}

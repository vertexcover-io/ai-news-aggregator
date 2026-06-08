import type { ReactElement } from "react";
import type { IncidentSeverity } from "@newsletter/shared/alerting";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<IncidentSeverity, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  error: "bg-orange-100 text-orange-800 border-orange-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  info: "bg-blue-100 text-blue-800 border-blue-200",
};

interface SeverityBadgeProps {
  severity: IncidentSeverity;
}

export function SeverityBadge({ severity }: SeverityBadgeProps): ReactElement {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", SEVERITY_STYLES[severity])}
    >
      {severity}
    </Badge>
  );
}

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmptyState(): ReactElement {
  return (
    <Card className="mx-auto max-w-lg items-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold">Get started</h2>
      <p className="text-sm text-muted-foreground">
        You haven&apos;t set up your newsletter yet. Configure your sources and
        schedule to start collecting.
      </p>
      <Button asChild>
        <Link to="/admin/settings">Configure your newsletter</Link>
      </Button>
    </Card>
  );
}

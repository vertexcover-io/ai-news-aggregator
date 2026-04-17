import type { ReactElement } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "@/api/admin";
import { Button } from "@/components/ui/button";

export function AdminLayout(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut(): Promise<void> {
    await logout();
    await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
    await navigate("/");
  }

  return (
    <div>
      <header className="flex justify-end items-center gap-2 px-4 py-2 border-b">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void handleSignOut();
          }}
        >
          Sign out
        </Button>
      </header>
      <Outlet />
    </div>
  );
}

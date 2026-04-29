import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-11 w-11 shrink-0 items-center justify-center bg-transparent border-0 shadow-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-all disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="relative inline-flex h-[1.15rem] w-8 items-center rounded-full border border-transparent shadow-xs transition-colors bg-input group-data-[state=checked]/switch:bg-primary dark:bg-input/80"
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  );
}

export { Switch };

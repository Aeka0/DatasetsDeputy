import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  subtle?: boolean;
}

export function GlassPanel({ className, subtle = false, ...props }: GlassPanelProps) {
  return (
    <div
      className={cn(
        "glass-panel rounded-3xl",
        subtle && "bg-white/[0.045] shadow-none",
        className
      )}
      {...props}
    />
  );
}

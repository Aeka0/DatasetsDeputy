import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border border-slate-200 bg-white px-2 text-[11px] leading-5 text-slate-600",
        className
      )}
      {...props}
    />
  );
}

import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "icon";
}

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "no-drag inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" &&
          "border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800",
        variant === "secondary" &&
          "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
        variant === "ghost" &&
          "border border-transparent bg-transparent text-neutral-700 hover:bg-neutral-900/[0.06]",
        variant === "danger" &&
          "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
        variant === "icon" &&
          "h-8 w-8 border border-transparent bg-transparent p-0 text-neutral-600 hover:bg-neutral-900/[0.06] hover:text-neutral-900",
        className
      )}
      {...props}
    />
  );
}

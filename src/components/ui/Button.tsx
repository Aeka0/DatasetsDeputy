import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
}

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "no-drag inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" &&
          "bg-blue-500/85 text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400",
        variant === "ghost" &&
          "border border-white/10 bg-white/[0.06] text-white/82 hover:bg-white/[0.12]",
        variant === "danger" &&
          "border border-red-300/20 bg-red-500/18 text-red-100 hover:bg-red-500/28",
        className
      )}
      {...props}
    />
  );
}

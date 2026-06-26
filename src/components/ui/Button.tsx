import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle" | "icon";
  icon?: ReactNode;
}

export function Button({
  className,
  variant = "primary",
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "no-drag inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "app-button-primary border font-medium",
        variant === "secondary" && "app-button-secondary border",
        variant === "ghost" && "app-button-ghost border border-transparent bg-transparent",
        variant === "danger" && "app-button-danger border",
        variant === "subtle" &&
          "border border-transparent bg-transparent text-neutral-700 subtle-highlight-button",
        variant === "icon" &&
          "app-button-icon shrink-0 border border-transparent bg-transparent !px-0",
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

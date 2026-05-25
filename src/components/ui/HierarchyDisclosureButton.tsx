import { ChevronDown, ChevronRight } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface HierarchyDisclosureButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  expanded: boolean;
  iconSize?: number;
}

export function HierarchyDisclosureButton({
  expanded,
  iconSize = 14,
  className,
  ...props
}: HierarchyDisclosureButtonProps) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        "hierarchy-disclosure-button no-drag flex h-full w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-black/20",
        className
      )}
      aria-expanded={expanded}
    >
      {expanded ? (
        <ChevronDown size={iconSize} className="hierarchy-disclosure-icon shrink-0" />
      ) : (
        <ChevronRight size={iconSize} className="hierarchy-disclosure-icon shrink-0" />
      )}
    </button>
  );
}

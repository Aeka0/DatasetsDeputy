import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";

export interface AppSelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface AppSelectProps<T extends string = string> {
  value: T;
  options: AppSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function AppSelect<T extends string = string>({
  value,
  options,
  onChange,
  className
}: AppSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("no-drag relative", className)}>
      <button
        type="button"
        className="glass-input flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{selectedOption?.label}</span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-neutral-400 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="app-dropdown-menu absolute left-0 top-9 z-[70] min-w-full rounded-lg py-2">
          <div className="app-dropdown-backdrop" />
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition hover:bg-neutral-100",
                  selected ? "text-neutral-950" : "text-neutral-600"
                )}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {selected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
